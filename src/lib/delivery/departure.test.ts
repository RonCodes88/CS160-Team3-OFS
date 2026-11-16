import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { departWithFreshRoute } from "./departure";
function fixture(state: string) {
  const rpc = vi.fn().mockImplementation(async (name: string) => ({ error: null,
    data: name === "delivery_prepare_departure_route" ? state : "vehicle" }));
  const db = { rpc } as unknown as SupabaseClient;
  return { db, rpc, route: vi.fn().mockResolvedValue(undefined) };
}
describe("fresh route departure orchestration", () => {
  it("keeps unavailable trips waiting without calling the route provider", async () => {
    const { db, rpc, route } = fixture("WAIT");
    expect(await departWithFreshRoute(db, "trip", { route })).toBeNull();
    expect(route).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("reuses a fresh plan", async () => {
    const { db, rpc, route } = fixture("READY");
    expect(await departWithFreshRoute(db, "trip", { route })).toBe("vehicle");
    expect(route).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledWith("delivery_dispatch_trip", { p_trip_id: "trip" });
  });
  it("requests current traffic before dispatching a stale plan", async () => {
    const { db, rpc, route } = fixture("REPLAN");
    await departWithFreshRoute(db, "trip", { route, vehicleId: "vehicle" });
    expect(route).toHaveBeenCalledWith("trip");
    expect(rpc).toHaveBeenLastCalledWith("delivery_dispatch_trip", { p_trip_id: "trip", p_vehicle_id: "vehicle" });
    expect(route.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[1]);
  });
  it("does not depart if route refresh fails", async () => {
    const { db, rpc, route } = fixture("REPLAN"); route.mockRejectedValue(new Error("traffic unavailable"));
    await expect(departWithFreshRoute(db, "trip", { route })).rejects.toThrow("traffic unavailable");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("does not guess when preparation fails or returns invalid data", async () => {
    const { db, rpc, route } = fixture("unknown");
    await expect(departWithFreshRoute(db, "trip", { route })).rejects.toThrow("Invalid departure");
    rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    await expect(departWithFreshRoute(db, "trip", { route })).rejects.toThrow("database unavailable");
    expect(route).not.toHaveBeenCalled();
  });
});
