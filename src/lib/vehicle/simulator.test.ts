import { afterEach, describe, expect, it, vi } from "vitest";
import { createRobotClient, legPoints, simulateAssignedTrip } from "./simulator";

const tripId = "11111111-1111-4111-8111-111111111111";
const stopId = "22222222-2222-4222-8222-222222222222";
const trip = { id: tripId, status: "OUT_FOR_DELIVERY", routeGeometry: null,
  stops: [{ id: stopId, status: "PENDING", stopSequence: 1, location: { lat: 37.34, lng: -121.89 } }] };
const login = () => Response.json({ user: { role: "VEHICLE" } }, { headers: { "set-cookie": "ofs_session=opaque-token; Path=/; HttpOnly" } });
function fixture(current: unknown = trip) {
  const requests: { path: string; init?: RequestInit }[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname; requests.push({ path, init });
    if (path === "/api/auth/login") return login();
    if (path === "/api/vehicle/trip") return Response.json({ trip: current });
    return Response.json({ ok: true });
  });
  const pause = vi.fn().mockResolvedValue(undefined);
  const client = createRobotClient({ baseUrl: "http://127.0.0.1:3000", email: "robot@test.local", password: "test-only", fetcher, pause });
  return { client, fetcher, requests, pause };
}
afterEach(() => vi.restoreAllMocks());
describe("HTTP robot simulator", () => {
  it("authenticates and delivers through the actual vehicle HTTP contract", async () => {
    const { client, requests } = fixture();
    expect(await simulateAssignedTrip(client)).toEqual({ tripId, delivered: 1 });
    expect(requests.map(request => request.path)).toEqual(["/api/auth/login", "/api/vehicle/trip", "/api/vehicle/location",
      `/api/vehicle/stops/${stopId}`, `/api/vehicle/stops/${stopId}`]);
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ email: "robot@test.local", password: "test-only" });
    for (const request of requests.slice(1)) expect(new Headers(request.init?.headers).get("cookie")).toBe("ofs_session=opaque-token");
    expect(JSON.parse(String(requests[3].init?.body))).toEqual({ status: "ARRIVED" });
    expect(JSON.parse(String(requests[4].init?.body))).toEqual({ status: "DELIVERED" });
  });
  it("resumes an arrived stop without repeating arrival, and skips delivered stops", async () => {
    const { client, requests } = fixture({ ...trip, stops: [
      { ...trip.stops[0], status: "ARRIVED" }, { ...trip.stops[0], id: "33333333-3333-4333-8333-333333333333", stopSequence: 2, status: "DELIVERED" },
    ] });
    expect((await simulateAssignedTrip(client)).delivered).toBe(1);
    expect(requests.map(request => request.path)).toEqual(["/api/auth/login", "/api/vehicle/trip", `/api/vehicle/stops/${stopId}`]);
  });
  it("retries a lost delivered acknowledgement using the identical mutation", async () => {
    const { client, fetcher, requests } = fixture();
    const original = fetcher.getMockImplementation()!;
    let dropped = false;
    fetcher.mockImplementation(async (...args) => {
      const response = await original(...args);
      if (!dropped && args[1]?.body === '{"status":"DELIVERED"}') { dropped = true; throw new Error("connection closed"); }
      return response;
    });
    expect((await simulateAssignedTrip(client)).delivered).toBe(1);
    expect(requests.filter(request => request.init?.body === '{"status":"DELIVERED"}')).toHaveLength(2);
  });
  it("does nothing when no assignment exists", async () => {
    const { client, requests } = fixture(null);
    expect(await simulateAssignedTrip(client)).toEqual({ tripId: null, delivered: 0 });
    expect(requests).toHaveLength(2);
  });
  it("rejects malformed or over-capacity assignments before reporting mutations", async () => {
    for (const current of [{ ...trip, stops: Array(11).fill(trip.stops[0]) },
      { ...trip, stops: [{ ...trip.stops[0], location: { lat: NaN, lng: 0 } }] }, { ...trip, status: "ROUTED" }]) {
      const { client, requests } = fixture(current);
      await expect(simulateAssignedTrip(client)).rejects.toThrow("assignment");
      expect(requests).toHaveLength(2);
    }
  });
  it("bounds retries and never retries authorization failures as mutations", async () => {
    const { client, fetcher } = fixture();
    fetcher.mockImplementation(async url => new URL(String(url)).pathname === "/api/auth/login" ? login() : new Response(null, { status: 503 }));
    await expect(simulateAssignedTrip(client)).rejects.toThrow("503");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("refuses remote or credential-bearing URLs unless explicitly permitted", () => {
    const credentials = { email: "robot@test.local", password: "secret" };
    for (const baseUrl of ["http://example.com", "https://example.com", "http://user:pass@localhost", "http://localhost/path"]) {
      expect(() => createRobotClient({ ...credentials, baseUrl })).toThrow();
    }
    expect(() => createRobotClient({ ...credentials, baseUrl: "https://test.example.com", allowRemote: true })).not.toThrow();
  });
});

describe("driving along the route", () => {
  const secondStop = "33333333-3333-4333-8333-333333333333";
  // Store at -121.88, first stop at -121.86, second stop at -121.83 (all on one latitude).
  const route = { type: "LineString", coordinates: [-121.88, -121.87, -121.86, -121.85, -121.84, -121.83, -121.82].map(lng => [lng, 37.33]) };
  const twoStops = { ...trip, routeGeometry: route, stops: [
    { id: stopId, status: "PENDING", stopSequence: 1, location: { lat: 37.33, lng: -121.86 } },
    { id: secondStop, status: "PENDING", stopSequence: 2, location: { lat: 37.33, lng: -121.83 } },
  ] };
  const reported = (requests: { path: string; init?: RequestInit }[]) => requests
    .filter(request => request.path === "/api/vehicle/location")
    .map(request => JSON.parse(String(request.init?.body)).longitude);

  it("reports positions along the road before arriving at each stop, in order", async () => {
    const { client, requests } = fixture(twoStops);
    expect(await simulateAssignedTrip(client, { driveSteps: 10 })).toEqual({ tripId, delivered: 2 });
    expect(reported(requests)).toEqual([-121.87, -121.86, -121.85, -121.84, -121.83]);
    const statuses = requests.filter(request => request.path.startsWith("/api/vehicle/stops/"))
      .map(request => `${request.path.slice(-4)} ${JSON.parse(String(request.init?.body)).status}`);
    expect(statuses).toEqual(["2222 ARRIVED", "2222 DELIVERED", "3333 ARRIVED", "3333 DELIVERED"]);
  });

  it("pauses between moves and waits at the door before delivering", async () => {
    const { client, pause } = fixture(twoStops);
    await simulateAssignedTrip(client, { driveSteps: 10, stepMs: 1000, arrivalWaitMs: 30000, pause });
    expect(pause.mock.calls.map(call => call[0])).toEqual([1000, 1000, 30000, 1000, 1000, 1000, 30000]);
  });

  it("goes straight to the stop when the route is missing or malformed", async () => {
    for (const routeGeometry of [null, { type: "Point", coordinates: [0, 0] }, { type: "LineString", coordinates: [[0, 0], ["x", 1]] }]) {
      const { client, requests } = fixture({ ...twoStops, routeGeometry });
      expect((await simulateAssignedTrip(client, { driveSteps: 10 })).delivered).toBe(2);
      expect(reported(requests)).toEqual([-121.86, -121.83]);
    }
  });

  it("stops mid-drive when asked to stop", async () => {
    const { client, requests } = fixture(twoStops);
    // Stop once the robot is partway to the second stop.
    const result = await simulateAssignedTrip(client, { driveSteps: 10, shouldStop: () => reported(requests).length >= 3 });
    expect(result).toEqual({ tripId, delivered: 1 });
    expect(reported(requests)).toEqual([-121.87, -121.86, -121.85]);
    expect(requests.some(request => request.path === `/api/vehicle/stops/${secondStop}`)).toBe(false);
  });

  it.each([-1, 1.5, 101])("rejects %d drive steps", async driveSteps => {
    const { client } = fixture(twoStops);
    await expect(simulateAssignedTrip(client, { driveSteps })).rejects.toThrow("drive steps");
  });

  it("rejects an arrival wait over a minute", async () => {
    const { client } = fixture(twoStops);
    await expect(simulateAssignedTrip(client, { arrivalWaitMs: 60001 })).rejects.toThrow("between 0 and 60000");
  });
});

describe("legPoints", () => {
  const path = Array.from({ length: 21 }, (_, index) => ({ lat: 37.33, lng: -121.9 + index / 1000 }));

  it("thins a long leg to evenly spaced points that end before the stop", () => {
    const { points, end } = legPoints(path, 0, path[20], 4);
    expect(end).toBe(20);
    expect(points).toHaveLength(4);
    expect(points.map(point => path.indexOf(point))).toEqual([4, 8, 12, 16]);
  });

  it("continues from where the last leg ended", () => {
    expect(legPoints(path, 5, path[8], 10)).toEqual({ points: [path[6], path[7]], end: 8 });
  });

  it("returns no points when the robot is already at the closest point", () => {
    expect(legPoints(path, 20, path[20], 10)).toEqual({ points: [], end: 20 });
  });
});
