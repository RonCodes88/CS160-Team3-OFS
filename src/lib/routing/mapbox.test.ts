import createDirectionsService, {
  type DirectionsRequest,
  type DirectionsService,
} from "@mapbox/mapbox-sdk/services/directions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORE_LOCATION } from "@/lib/delivery/store";
import { fetchTripRoute, RoutingError, type RouteRequest } from "./mapbox";

// The real SDK is never called; every test supplies the Directions response.
vi.mock("@mapbox/mapbox-sdk/services/directions", () => ({ default: vi.fn() }));

const A = { lat: 37.3361, lng: -121.8905 };
const B = { lat: 37.3229, lng: -121.8814 };

type Reply = { body: unknown } | { error: unknown } | "hang";

/** A fake Directions service that records requests and replies as told. */
function fakeDirections(reply: Reply) {
  const requests: DirectionsRequest[] = [];
  const abort = vi.fn();
  const service: DirectionsService = {
    getDirections(request) {
      requests.push(request);
      let rejectSend: (err: unknown) => void = () => {};
      abort.mockImplementation(() => rejectSend({ type: "RequestAbortedError", message: "aborted" }));
      return {
        send: () =>
          new Promise((resolve, reject) => {
            rejectSend = reject;
            if (reply === "hang") return;
            if ("error" in reply) reject(reply.error);
            else resolve({ statusCode: 200, body: reply.body });
          }),
        abort,
      };
    },
  };
  return { service, requests, abort };
}

/** A Mapbox "Ok" body with one leg per hop. */
function okBody(legs: number) {
  return {
    code: "Ok",
    routes: [
      {
        distance: 4321.6,
        duration: 612.4,
        geometry: { type: "LineString", coordinates: [[-121.8811, 37.3352], [-121.8905, 37.3361]] },
        legs: Array.from({ length: legs }, (_, i) => ({ distance: 1000.4 + i, duration: 150.6 + i })),
      },
    ],
  };
}

async function routeError(request: RouteRequest, reply: Reply, timeoutMs?: number): Promise<RoutingError> {
  const { service } = fakeDirections(reply);
  const err = await fetchTripRoute(request, { directions: service, timeoutMs }).catch((e) => e);
  expect(err).toBeInstanceOf(RoutingError);
  return err as RoutingError;
}

describe("fetchTripRoute request", () => {
  it("starts at the store, visits stops in order, and returns to the store", async () => {
    const { service, requests } = fakeDirections({ body: okBody(3) });
    await fetchTripRoute({ stops: [A, B] }, { directions: service });

    expect(requests).toEqual([
      {
        profile: "driving",
        waypoints: [
          { coordinates: [STORE_LOCATION.lng, STORE_LOCATION.lat] },
          { coordinates: [A.lng, A.lat] },
          { coordinates: [B.lng, B.lat] },
          { coordinates: [STORE_LOCATION.lng, STORE_LOCATION.lat] },
        ],
        geometries: "geojson",
        overview: "full",
        steps: false,
      },
    ]);
  });

  it("can skip the return leg, use another origin, and use another profile", async () => {
    const { service, requests } = fakeDirections({ body: okBody(1) });
    await fetchTripRoute({ stops: [B], origin: A, returnToOrigin: false }, { directions: service, profile: "walking" });
    expect(requests[0].profile).toBe("walking");
    expect(requests[0].waypoints).toEqual([{ coordinates: [A.lng, A.lat] }, { coordinates: [B.lng, B.lat] }]);
  });

  it("allows a full 10-order trip", async () => {
    const { service } = fakeDirections({ body: okBody(11) });
    const route = await fetchTripRoute({ stops: Array(10).fill(A) }, { directions: service });
    expect(route.legs).toHaveLength(11);
  });

  it("reads the token from MAPBOX_ACCESS_TOKEN", async () => {
    const { service } = fakeDirections({ body: okBody(2) });
    vi.mocked(createDirectionsService).mockReturnValue(service);
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", "sk.test-token");
    await fetchTripRoute({ stops: [A] });
    expect(createDirectionsService).toHaveBeenCalledWith({ accessToken: "sk.test-token" });
    vi.unstubAllEnvs();
  });
});

describe("fetchTripRoute response", () => {
  it("parses geometry, total distance and duration, and each leg as whole meters and seconds", async () => {
    const { service } = fakeDirections({ body: okBody(3) });
    expect(await fetchTripRoute({ stops: [A, B] }, { directions: service })).toEqual({
      geometry: { type: "LineString", coordinates: [[-121.8811, 37.3352], [-121.8905, 37.3361]] },
      distanceMeters: 4322,
      durationSeconds: 612,
      legs: [
        { distanceMeters: 1000, durationSeconds: 151 },
        { distanceMeters: 1001, durationSeconds: 152 },
        { distanceMeters: 1002, durationSeconds: 153 },
      ],
    });
  });

  it("rejects a route whose legs don't match the stops", async () => {
    expect((await routeError({ stops: [A, B] }, { body: okBody(2) })).code).toBe("PROVIDER_ERROR");
  });
});

describe("fetchTripRoute errors", () => {
  beforeEach(() => vi.mocked(createDirectionsService).mockClear());
  afterEach(() => vi.unstubAllEnvs());

  it("rejects bad requests before calling Mapbox", async () => {
    const { service, requests } = fakeDirections({ body: okBody(1) });
    for (const request of [
      { stops: [] },
      { stops: Array(24).fill(A) }, // 26 waypoints with the store and the return leg
      { stops: [{ lat: 91, lng: 0 }] },
      { stops: [{ lat: Number.NaN, lng: 0 }] },
    ]) {
      const err = await fetchTripRoute(request, { directions: service }).catch((e) => e);
      expect(err).toMatchObject({ name: "RoutingError", code: "INVALID_REQUEST" });
    }
    expect(requests).toEqual([]);
  });

  it("reports a missing token without calling Mapbox", async () => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", "");
    const err = await fetchTripRoute({ stops: [A] }).catch((e) => e);
    expect(err).toMatchObject({ code: "NOT_CONFIGURED" });
    expect(createDirectionsService).not.toHaveBeenCalled();
  });

  it.each([
    ["NoRoute", { body: { code: "NoRoute", routes: [] } }, "NO_ROUTE"],
    ["no routes", { body: { code: "Ok", routes: [] } }, "NO_ROUTE"],
    ["HTTP 401", { error: { type: "HttpError", statusCode: 401, body: { message: "Not Authorized" } } }, "UNAUTHORIZED"],
    ["HTTP 429", { error: { type: "HttpError", statusCode: 429 } }, "RATE_LIMITED"],
    ["HTTP 422", { error: { type: "HttpError", statusCode: 422, body: { code: "InvalidInput" } } }, "INVALID_REQUEST"],
    ["NoSegment", { error: { type: "HttpError", statusCode: 422, body: { code: "NoSegment" } } }, "NO_ROUTE"],
    ["HTTP 500", { error: { type: "HttpError", statusCode: 500 } }, "PROVIDER_ERROR"],
    ["network failure", { error: new Error("ECONNRESET") }, "PROVIDER_ERROR"],
  ] as const)("surfaces %s as %s", async (_name, reply, code) => {
    expect((await routeError({ stops: [A] }, reply)).code).toBe(code);
  });

  it("aborts and reports a timeout when Mapbox doesn't answer", async () => {
    const { service, abort } = fakeDirections("hang");
    const err = await fetchTripRoute({ stops: [A] }, { directions: service, timeoutMs: 20 }).catch((e) => e);
    expect(err).toMatchObject({ code: "TIMEOUT" });
    expect(abort).toHaveBeenCalledOnce();
  });

  it("keeps the status code and never leaks the token in messages", async () => {
    const reply = { error: { type: "HttpError", statusCode: 401, message: "https://api.mapbox.com/...?access_token=sk.secret" } };
    const err = await routeError({ stops: [A] }, reply);
    expect(err.status).toBe(401);
    expect(err.message).not.toContain("sk.secret");
  });
});
