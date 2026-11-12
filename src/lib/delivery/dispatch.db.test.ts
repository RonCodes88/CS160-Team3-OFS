import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
try { process.loadEnvFile(".env.test.local"); } catch { /* Optional test config. */ }
const url = process.env.SUPABASE_TEST_URL, key = process.env.SUPABASE_TEST_SECRET_KEY;
if (url && !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(url)) throw new Error("Local test DB required");
describe.skipIf(!url || !key)("atomic delivery assignment", () => {
  let db: SupabaseClient;
  const customer = randomUUID(), trips: string[] = [];
  beforeAll(async () => {
    db = createClient(url!, key!, { auth: { persistSession: false } });
    const { error } = await db.from("users").insert({ id: customer, email: `${customer}@test.local`, password_hash: "test" });
    if (error) throw error;
  });
  afterAll(async () => {
    if (!db) return;
    const deleted = await db.from("orders").delete().eq("customer_id", customer); if (deleted.error) throw deleted.error;
    if (trips.length) { const result = await db.from("trips").delete().in("id", trips); if (result.error) throw result.error; }
    const result = await db.from("users").delete().eq("id", customer); if (result.error) throw result.error;
  });
  async function order(weight: number, age = 0) {
    const id = randomUUID();
    const { error } = await db.from("orders").insert({ id, customer_id: customer, status: "PAID",
      paid_at: new Date(Date.now() - age * 60000).toISOString(), total_weight: weight,
      delivery_address: {}, location: "SRID=4326;POINT(0 0)" });
    if (error) throw error; return id;
  }
  async function claim(ids: string[], minutes = 20) {
    const result = await db.rpc("delivery_create_trip", { p_order_ids: ids, p_wait_minutes: minutes });
    if (result.data) trips.push(result.data); return result;
  }
  it("keeps a young partial trip queued", async () => {
    const result = await claim([await order(19999)]); expect(result.error).toBeNull(); expect(result.data).toBeNull();
  });
  it("claims a full-weight order only once under concurrent workers", async () => {
    const id = await order(20000);
    const results = await Promise.all([claim([id]), claim([id])]);
    expect(results.every(result => !result.error)).toBe(true);
    expect(results.filter(result => result.data)).toHaveLength(1);
    const saved = await db.from("orders").select("status,trip_id").eq("id", id).single();
    expect(saved.data?.status).toBe("BATCHED"); expect(saved.data?.trip_id).toBeTruthy();
    const history = await db.from("order_status_history").select("status").eq("order_id", id);
    expect(history.data).toEqual([{ status: "BATCHED" }]);
  });
  it("dispatches ten young orders", async () => {
    const ids = await Promise.all(Array.from({ length: 10 }, () => order(100)));
    const result = await claim(ids); expect(result.error).toBeNull(); expect(result.data).toBeTruthy();
  });
  it("honors a custom wait limit", async () => {
    const result = await claim([await order(100, 6)], 5); expect(result.error).toBeNull(); expect(result.data).toBeTruthy();
  });
  it("rejects overweight plans without changing orders", async () => {
    const ids = [await order(15000, 30), await order(15000, 30)];
    expect((await claim(ids)).error).toBeTruthy();
    const rows = await db.from("orders").select("status,trip_id").in("id", ids);
    expect(rows.data).toEqual([{ status: "PAID", trip_id: null }, { status: "PAID", trip_id: null }]);
  });
});
