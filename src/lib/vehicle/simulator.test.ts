import { afterEach, describe, expect, it, vi } from "vitest";
import { createRobotClient, simulateAssignedTrip } from "./simulator";

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
