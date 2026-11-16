import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { departWithFreshRoute } from "@/lib/delivery/departure";
import { runDeliveryTick, type DeliveryJob } from "@/lib/delivery/job";
import { getPendingDeliveryOrders } from "@/lib/orders/queue";
import { routeTripById } from "@/lib/routing/service";
import { createDeliveryTick } from "./worker";

vi.mock("@/lib/delivery/job", () => ({ runDeliveryTick: vi.fn() }));
vi.mock("@/lib/delivery/departure", () => ({ departWithFreshRoute: vi.fn() }));
vi.mock("@/lib/orders/queue", () => ({ getPendingDeliveryOrders: vi.fn() }));
vi.mock("@/lib/routing/service", () => ({ routeTripById: vi.fn() }));

function fakeDb(trips: { data: { id: string }[] | null; error: unknown }, rpc: { data: unknown; error: unknown }) {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(async () => trips) };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const db = { from: vi.fn(() => query), rpc: vi.fn(async () => rpc) };
  return { db: db as unknown as SupabaseClient, query, raw: db };
}

async function depsFor(db: SupabaseClient, report = vi.fn()): Promise<DeliveryJob> {
  await createDeliveryTick(db, 20, report)(new Date("2026-11-16T12:00:00Z"));
  return vi.mocked(runDeliveryTick).mock.calls[0][0];
}

beforeEach(() => vi.clearAllMocks());

describe("createDeliveryTick", () => {
  it("runs one tick with the wait limit and the given time", async () => {
    const { db } = fakeDb({ data: [], error: null }, { data: null, error: null });
    await createDeliveryTick(db, 1)(new Date("2026-11-16T12:00:00Z"));
    expect(runDeliveryTick).toHaveBeenCalledWith(expect.any(Object), new Date("2026-11-16T12:00:00Z"), 1);
  });

  it("reads PLANNED and ROUTED trips oldest first", async () => {
    const { db, query } = fakeDb({ data: [{ id: "t1" }, { id: "t2" }], error: null }, { data: null, error: null });
    const deps = await depsFor(db);
    expect(await deps.pendingTrips()).toEqual(["t1", "t2"]);
    expect(query.eq).toHaveBeenLastCalledWith("status", "PLANNED");
    expect(await deps.routedTrips()).toEqual(["t1", "t2"]);
    expect(query.eq).toHaveBeenLastCalledWith("status", "ROUTED");
    expect(query.order).toHaveBeenCalledWith("created_at");
  });

  it("creates a trip through the database function", async () => {
    const { db, raw } = fakeDb({ data: [], error: null }, { data: "trip-1", error: null });
    const deps = await depsFor(db);
    expect(await deps.createTrip(["o1", "o2"], 20)).toBe("trip-1");
    expect(raw.rpc).toHaveBeenCalledWith("delivery_create_trip", { p_order_ids: ["o1", "o2"], p_wait_minutes: 20 });
  });

  it("passes database errors to the tick so it can report them", async () => {
    const failure = { message: "db down" };
    const { db } = fakeDb({ data: null, error: failure }, { data: null, error: failure });
    const deps = await depsFor(db);
    await expect(deps.pendingTrips()).rejects.toBe(failure);
    await expect(deps.createTrip(["o1"], 20)).rejects.toBe(failure);
  });

  it("uses the shared queue, routing, and departure code", async () => {
    const { db } = fakeDb({ data: [], error: null }, { data: null, error: null });
    const report = vi.fn();
    const deps = await depsFor(db, report);
    await deps.readQueue();
    await deps.route("t1");
    await deps.depart("t1");
    deps.report("x");
    expect(getPendingDeliveryOrders).toHaveBeenCalledWith(db);
    expect(routeTripById).toHaveBeenCalledWith(db, "t1");
    expect(departWithFreshRoute).toHaveBeenCalledWith(db, "t1");
    expect(report).toHaveBeenCalledWith("x");
  });
});
