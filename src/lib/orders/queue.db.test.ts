import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPendingDeliveryOrders } from "./queue";

try { process.loadEnvFile(".env.test.local"); } catch { /* Optional local test configuration. */ }
const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_SECRET_KEY;
if (url && !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(url)) {
  throw new Error("Queue tests require a local test database.");
}

describe.skipIf(!url || !key)("pending queue against Postgres", () => {
  let db: SupabaseClient;
  const customer = randomUUID();
  const ids: string[] = Array.from({ length: 8 }, () => randomUUID());
  const trip = randomUUID();
  const paidAt = "2026-11-04T12:00:00.000Z";
  const older = "2026-11-04T11:00:00.000Z";

  beforeAll(async () => {
    db = createClient(url!, key!, { auth: { persistSession: false } });
    const user = await db.from("users").insert({ id: customer, email: `queue-${customer}@test.local`, password_hash: "test-only" });
    if (user.error) throw user.error;
    const planned = await db.from("trips").insert({ id: trip, order_count: 1, total_weight: 19999 });
    if (planned.error) throw planned.error;
    const orders = await db.from("orders").insert(ids.map((id, i) => ({
      id, customer_id: customer, status: i === 3 ? "CANCELED" : i === 5 ? "PREPARING" : i === 6 ? "BATCHED" : "PAID",
      trip_id: i === 7 ? trip : null,
      paid_at: i === 4 ? null : i === 2 ? older : paidAt,
      total_weight: 19999, subtotal_cents: 100, total_cents: 100,
      delivery_address: { line_1: "Queue fixture" },
      location: "SRID=4326;POINT(-121.8811 37.3352)",
    })));
    if (orders.error) throw orders.error;
  });

  afterAll(async () => {
    if (!db) return;
    const orders = await db.from("orders").delete().eq("customer_id", customer);
    if (orders.error) throw orders.error;
    const planned = await db.from("trips").delete().eq("id", trip);
    if (planned.error) throw planned.error;
    const user = await db.from("users").delete().eq("id", customer);
    if (user.error) throw user.error;
  });

  async function ownQueue() {
    return (await getPendingDeliveryOrders(db)).filter((order) => ids.includes(order.orderId));
  }

  it("automatically exposes paid orders oldest-first, breaking timestamp ties by ID", async () => {
    const queue = await ownQueue();
    expect(queue.map((order) => order.orderId)).toEqual([ids[2], ...ids.slice(0, 2).sort()]);
    expect(queue[0]).toEqual({ orderId: ids[2], paidAt: new Date(older), totalWeight: 19999,
      location: { lat: 37.3352, lng: -121.8811 } });
  });

  it("excludes canceled, preparing, batched, assigned, and undated orders", async () => {
    const queue = await ownQueue();
    expect(queue.map((order) => order.orderId)).not.toContain(ids[3]);
    expect(queue.map((order) => order.orderId)).not.toContain(ids[4]);
    for (const id of ids.slice(5)) expect(queue.map((order) => order.orderId)).not.toContain(id);
  });

  it("does not duplicate or consume orders on repeated reads", async () => {
    const first = await ownQueue();
    expect(await ownQueue()).toEqual(first);
    expect(new Set(first.map((order) => order.orderId)).size).toBe(first.length);
  });

  it("restores the original queue position after route failure", async () => {
    const assigned = await db.from("orders").update({ status: "BATCHED", trip_id: trip }).eq("id", ids[2]);
    if (assigned.error) throw assigned.error;
    // Remove the deliberately inconsistent assigned-PAID fixture before exercising routing.
    const detached = await db.from("orders").update({ trip_id: null, status: "CANCELED" }).eq("id", ids[7]);
    if (detached.error) throw detached.error;
    expect((await ownQueue()).map((order) => order.orderId)).not.toContain(ids[2]);
    const failed = await db.rpc("fail_trip_route", { p_trip_id: trip, p_failure_code: "ROUTING_UNAVAILABLE" });
    if (failed.error) throw failed.error;
    const queue = await ownQueue();
    expect(queue[0].orderId).toBe(ids[2]);
    expect(queue[0].paidAt).toEqual(new Date(older));
    expect(queue.filter((order) => order.orderId === ids[2])).toHaveLength(1);
  });
});
