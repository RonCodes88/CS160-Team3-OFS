import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { routeTripById } from "@/lib/routing/service";
import { departWithFreshRoute } from "./departure";
try { process.loadEnvFile(".env.test.local"); } catch { /* Optional test settings. */ }
const url = process.env.SUPABASE_TEST_URL, key = process.env.SUPABASE_TEST_SECRET_KEY;
if (url && !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(url)) throw new Error("Local test database required");

describe.skipIf(!url || !key)("transactional vehicle departure", () => {
  let db: SupabaseClient;
  const customer = randomUUID();
  const users: string[] = [customer], vehicles: string[] = [], trips: string[] = [];
  async function insert(table: string, row: object) {
    const id = randomUUID();
    const { error } = await db.from(table).insert({ id, ...row });
    if (error) throw error;
    return id;
  }
  beforeAll(async () => {
    db = createClient(url!, key!, { auth: { persistSession: false } });
    const { error } = await db.from("users").insert({ id: customer, email: `${customer}@test.local`, password_hash: "test" });
    if (error) throw error;
  });
  afterAll(async () => {
    if (!db) return;
    await db.from("vehicles").update({ current_trip_id: null }).in("id", vehicles);
    for (const [table, column, ids] of [
      ["delivery_stops", "trip_id", trips], ["orders", "customer_id", [customer]], ["trips", "id", trips], ["vehicles", "id", vehicles], ["users", "id", users],
    ] as const) {
      if (ids.length) { const { error } = await db.from(table).delete().in(column, ids); if (error) throw error; }
    }
  });
  async function vehicle(status = "AVAILABLE", role = "VEHICLE") {
    const user = await insert("users", { email: `${randomUUID()}@test.local`, password_hash: "test", role }); users.push(user);
    const id = await insert("vehicles", { user_id: user, status }); vehicles.push(id); return id;
  }
  async function trip(weights = [100], options: { status?: string; declaredWeight?: number; missingStop?: boolean } = {}) {
    const id = await insert("trips", { status: options.status ?? "ROUTED", order_count: weights.length,
      total_weight: options.declaredWeight ?? weights.reduce((a, b) => a + b, 0),
      route_geometry: { type: "LineString", coordinates: [[-121.88, 37.33], [-121.89, 37.34]] } }); trips.push(id);
    for (const [index, weight] of weights.entries()) {
      const order = await insert("orders", { customer_id: customer, trip_id: id, status: "BATCHED", total_weight: weight,
        paid_at: new Date().toISOString(), delivery_address: {}, location: "SRID=4326;POINT(-121.89 37.34)" });
      if (!options.missingStop) await insert("delivery_stops", { trip_id: id, order_id: order, stop_sequence: index + 1,
        status: "PENDING", location: "SRID=4326;POINT(-121.89 37.34)" });
    }
    return id;
  }
  function depart(tripId: string, vehicleId: string) {
    return db.rpc("delivery_dispatch_trip", { p_trip_id: tripId, p_vehicle_id: vehicleId });
  }
  it("departs exactly once under concurrent retries and writes order history", async () => {
    const vehicleId = await vehicle(), tripId = await trip([100, 200]);
    const results = await Promise.all([depart(tripId, vehicleId), depart(tripId, vehicleId)]);
    expect(results.map(result => result.error)).toEqual([null, null]);
    expect(results.map(result => result.data)).toEqual([vehicleId, vehicleId]);
    expect((await db.from("trips").select("status,vehicle_id,dispatched_at").eq("id", tripId).single()).data)
      .toMatchObject({ status: "OUT_FOR_DELIVERY", vehicle_id: vehicleId, dispatched_at: expect.any(String) });
    const orders = await db.from("orders").select("id,status").eq("trip_id", tripId);
    expect(orders.data?.map(order => order.status)).toEqual(["OUT_FOR_DELIVERY", "OUT_FOR_DELIVERY"]);
    const history = await db.from("order_status_history").select("status").in("order_id", orders.data!.map(order => order.id));
    expect(history.data).toEqual([{ status: "OUT_FOR_DELIVERY" }, { status: "OUT_FOR_DELIVERY" }]);
  });
  it("one available robot cannot depart on two concurrent trips", async () => {
    const robot = await vehicle(), ids = [await trip(), await trip()];
    const results = await Promise.all(ids.map(id => depart(id, robot)));
    expect(results.every(result => !result.error)).toBe(true);
    expect(results.filter(result => result.data === robot)).toHaveLength(1);
    expect(results.filter(result => result.data === null)).toHaveLength(1);
  });
  it("keeps a routed trip waiting until a robot becomes available", async () => {
    const robot = await vehicle("OFFLINE"), id = await trip();
    expect((await depart(id, robot)).data).toBeNull();
    expect((await db.from("trips").select("status").eq("id", id).single()).data?.status).toBe("ROUTED");
    await db.from("vehicles").update({ status: "AVAILABLE" }).eq("id", robot);
    expect((await depart(id, robot)).data).toBe(robot);
  });
  it("rejects overweight or mismatched orders without consuming a vehicle", async () => {
    const robot = await vehicle();
    for (const id of [await trip([11000, 11000], { declaredWeight: 20000 }), await trip([100], { declaredWeight: 101 }),
      await trip([100], { missingStop: true }), await trip([100], { status: "PLANNED" })]) {
      expect((await depart(id, robot)).error).toBeTruthy();
    }
    expect((await db.from("vehicles").select("status,current_trip_id").eq("id", robot).single()).data)
      .toEqual({ status: "AVAILABLE", current_trip_id: null });
  });
  it("accepts exact capacity and rejects accounts without VEHICLE role", async () => {
    const wrongRole = await vehicle("AVAILABLE", "CUSTOMER"), robot = await vehicle();
    const id = await trip(Array(10).fill(2000));
    expect((await depart(id, wrongRole)).data).toBeNull();
    expect((await depart(id, robot)).data).toBe(robot);
  });
  it("rejects stale traffic plans atomically even after an earlier readiness check", async () => {
    const robot = await vehicle(), id = await trip();
    const ready = await db.rpc("delivery_prepare_departure_route", { p_trip_id: id, p_vehicle_id: robot });
    expect(ready.error).toBeNull(); expect(ready.data).toBe("READY");
    await db.from("trips").update({ route_planned_at: new Date(Date.now() - 120000).toISOString() }).eq("id", id);
    const result = await depart(id, robot);
    expect(result.error?.message).toContain("fresh");
    expect((await db.from("vehicles").select("status,current_trip_id").eq("id", robot).single()).data)
      .toEqual({ status: "AVAILABLE", current_trip_id: null });
    expect((await db.from("orders").select("status").eq("trip_id", id).single()).data?.status).toBe("BATCHED");
  });
  it("preserves stale routes while no robot is available, and replans once one is", async () => {
    const robot = await vehicle("OFFLINE"), id = await trip();
    await db.from("trips").update({ route_planned_at: new Date(Date.now() - 3600000).toISOString() }).eq("id", id);
    const original = await db.from("delivery_stops").select("id").eq("trip_id", id);
    const prepare = () => db.rpc("delivery_prepare_departure_route", { p_trip_id: id, p_vehicle_id: robot });
    expect((await prepare()).data).toBe("WAIT");
    expect((await db.from("delivery_stops").select("id").eq("trip_id", id)).data).toEqual(original.data);
    await db.from("vehicles").update({ status: "AVAILABLE" }).eq("id", robot);
    expect((await prepare()).data).toBe("REPLAN");
    expect((await db.from("delivery_stops").select("id").eq("trip_id", id)).data).toEqual([]);
    expect((await db.from("trips").select("status,route_geometry,route_planned_at").eq("id", id).single()).data)
      .toEqual({ status: "PLANNED", route_geometry: null, route_planned_at: null });
  });
  it("shifts fresh ETAs by the bounded wait exactly once on actual departure", async () => {
    const robot = await vehicle(), id = await trip();
    const planned = Date.now() - 30000, eta = planned + 90000;
    await db.from("trips").update({ route_planned_at: new Date(planned).toISOString() }).eq("id", id);
    await db.from("delivery_stops").update({ estimated_arrival: new Date(eta).toISOString() }).eq("trip_id", id);
    expect((await depart(id, robot)).error).toBeNull();
    const saved = await db.from("delivery_stops").select("estimated_arrival").eq("trip_id", id).single();
    const actual = await db.from("trips").select("dispatched_at").eq("id", id).single();
    const shift = Date.parse(saved.data!.estimated_arrival) - eta;
    expect(shift).toBeGreaterThanOrEqual(30000); expect(shift).toBeLessThan(60000);
    expect(Date.parse(saved.data!.estimated_arrival)).toBeGreaterThan(Date.parse(actual.data!.dispatched_at));
    await depart(id, robot);
    expect((await db.from("delivery_stops").select("estimated_arrival").eq("trip_id", id).single()).data).toEqual(saved.data);
  });
  it("returns orders to their original queue priority if refreshing traffic fails", async () => {
    const robot = await vehicle(), id = await trip();
    await db.from("trips").update({ route_planned_at: new Date(Date.now() - 120000).toISOString() }).eq("id", id);
    const before = await db.from("orders").select("id,paid_at").eq("trip_id", id).single();
    await expect(departWithFreshRoute(db, id, {
      vehicleId: robot,
      route: tripId => routeTripById(db, tripId, { origin: { lat: 37.33, lng: -121.88 },
        routeProvider: vi.fn().mockRejectedValue(new Error("traffic provider unavailable")) }),
    })).rejects.toThrow("traffic provider unavailable");
    expect((await db.from("trips").select("status").eq("id", id).single()).data?.status).toBe("ROUTE_FAILED");
    expect((await db.from("orders").select("status,trip_id,paid_at").eq("id", before.data!.id).single()).data)
      .toEqual({ status: "PAID", trip_id: null, paid_at: before.data!.paid_at });
  });
});
