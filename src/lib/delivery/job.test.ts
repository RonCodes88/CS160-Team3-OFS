import { describe, it, expect, vi } from "vitest";
import { runDeliveryTick } from "./job";
const order = { orderId: "one", totalWeight: 100, location: { lat: 0, lng: 0 }, paidAt: new Date(0) };
function fixture() {
  return { readQueue: vi.fn().mockResolvedValue([order]), createTrip: vi.fn().mockResolvedValue("trip"),
    pendingTrips: vi.fn().mockResolvedValue([]), route: vi.fn().mockResolvedValue(undefined),
    routedTrips: vi.fn().mockResolvedValue([]), depart: vi.fn().mockResolvedValue(undefined), report: vi.fn() };
}
describe("delivery tick", () => {
  it("leaves a young partial trip queued", async () => {
    const deps = fixture(); await runDeliveryTick(deps, new Date(1000), 20);
    expect(deps.createTrip).not.toHaveBeenCalled(); expect(deps.route).not.toHaveBeenCalled();
  });
  it("persists and routes an expired trip", async () => {
    const deps = fixture(); await runDeliveryTick(deps, new Date(1200000), 20);
    expect(deps.createTrip).toHaveBeenCalledWith(["one"], 20); expect(deps.route).toHaveBeenCalledWith("trip");
  });
  it("does not route a stale claim lost to another worker", async () => {
    const deps = fixture(); deps.createTrip.mockResolvedValue(null);
    await runDeliveryTick(deps, new Date(1200000), 20); expect(deps.route).not.toHaveBeenCalled();
  });
  it("retries persisted planned trips after a restart", async () => {
    const deps = fixture(); deps.pendingTrips.mockResolvedValue(["old"]);
    await runDeliveryTick(deps, new Date(1000), 20); expect(deps.route).toHaveBeenCalledWith("old");
  });
  it("continues routing other trips after one failure", async () => {
    const deps = fixture(); deps.pendingTrips.mockResolvedValue(["old", "other"]);
    deps.route.mockRejectedValueOnce(new Error("routing failed"));
    await runDeliveryTick(deps, new Date(1000), 20);
    expect(deps.report).toHaveBeenCalled(); expect(deps.route).toHaveBeenCalledWith("other");
  });
  it("recovers committed trips even when reading the new order queue fails", async () => {
    const deps = fixture();
    const error = new Error("queue unavailable");
    deps.pendingTrips.mockResolvedValue(["committed"]);
    deps.readQueue.mockRejectedValue(error);
    await runDeliveryTick(deps, new Date(1200000), 20);
    expect(deps.route).toHaveBeenCalledWith("committed");
    expect(deps.report).toHaveBeenCalledWith(error);
  });
  it("routes committed trips when a new trip claim fails", async () => {
    const deps = fixture();
    const error = new Error("claim unavailable");
    deps.pendingTrips.mockResolvedValue(["committed"]);
    deps.createTrip.mockRejectedValue(error);
    await runDeliveryTick(deps, new Date(1200000), 20);
    expect(deps.route).toHaveBeenCalledWith("committed");
    expect(deps.report).toHaveBeenCalledWith(error);
  });
  it("continues new batching if recovering planned trips fails", async () => {
    const deps = fixture();
    const error = new Error("planned trips unavailable");
    deps.pendingTrips.mockRejectedValue(error);
    await runDeliveryTick(deps, new Date(1200000), 20);
    expect(deps.route).toHaveBeenCalledWith("trip");
    expect(deps.report).toHaveBeenCalledWith(error);
  });
  it("departs routed trips left waiting for a robot or a worker restart", async () => {
    const deps = fixture();
    deps.routedTrips.mockResolvedValue(["waiting"]);
    await runDeliveryTick(deps, new Date(1000), 20);
    expect(deps.depart).toHaveBeenCalledWith("waiting");
  });
  it("checks for routed trips after routing newly committed trips", async () => {
    const deps = fixture();
    deps.route.mockImplementation(async () => { deps.routedTrips.mockResolvedValue(["trip"]); });
    await runDeliveryTick(deps, new Date(1200000), 20);
    expect(deps.depart).toHaveBeenCalledWith("trip");
  });
  it("keeps departures independent of queue failures and other departure failures", async () => {
    const deps = fixture();
    deps.readQueue.mockRejectedValue(new Error("queue unavailable"));
    deps.routedTrips.mockResolvedValue(["broken", "healthy"]);
    deps.depart.mockRejectedValueOnce(new Error("departure unavailable"));
    await runDeliveryTick(deps, new Date(1200000), 20);
    expect(deps.depart).toHaveBeenCalledWith("healthy");
    expect(deps.report).toHaveBeenCalledTimes(2);
  });
});
