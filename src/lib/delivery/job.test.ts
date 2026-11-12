import { describe, it, expect, vi } from "vitest";
import { runDeliveryTick } from "./job";
const order = { orderId: "one", totalWeight: 100, location: { lat: 0, lng: 0 }, paidAt: new Date(0) };
function fixture() {
  return { readQueue: vi.fn().mockResolvedValue([order]), createTrip: vi.fn().mockResolvedValue("trip"),
    pendingTrips: vi.fn().mockResolvedValue([]), route: vi.fn().mockResolvedValue(undefined), report: vi.fn() };
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
});
