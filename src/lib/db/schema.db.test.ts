import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Checks the schema's safety-net constraints against a LOCAL Supabase with the
// migrations applied. Setup: `npx supabase start`, then put SUPABASE_TEST_URL
// and SUPABASE_TEST_SECRET_KEY in .env.test.local. Skipped when not configured.
try {
  process.loadEnvFile(".env.test.local");
} catch {
  // Optional file.
}

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_KEY = process.env.SUPABASE_TEST_SECRET_KEY;

// host.docker.internal is the developer's own machine when tests run in Docker.
if (
  TEST_URL &&
  !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(TEST_URL)
) {
  throw new Error(`Refusing to run DB tests against non-local SUPABASE_TEST_URL: ${TEST_URL}`);
}

const run = randomUUID().slice(0, 8);
// PostGIS accepts EWKT for geography columns through the API.
const POINT = "SRID=4326;POINT(-121.8945 37.3361)";
const ADDRESS = { line_1: "1 Test St", city: "San Jose", state: "CA", postal_code: "95110", location: POINT };

describe.skipIf(!TEST_URL || !TEST_KEY)("schema constraints against Postgres", () => {
  let db: SupabaseClient;
  const created: { table: string; id: string }[] = [];
  let customerId: string;
  let vehicleUserId: string;

  async function insert(table: string, row: object): Promise<string> {
    const { data, error } = await db.from(table).insert(row).select("id").single();
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
    const id = (data as { id: string }).id;
    created.push({ table, id });
    return id;
  }

  async function insertError(table: string, row: object): Promise<string | undefined> {
    const { data, error } = await db.from(table).insert(row).select("id").maybeSingle();
    if (data) created.push({ table, id: (data as { id: string }).id });
    return error?.message;
  }

  async function newOrder(overrides: object = {}) {
    return insert("orders", {
      customer_id: customerId,
      total_weight: 500,
      delivery_address: { line_1: "1 Test St", city: "San Jose", state: "CA", postal_code: "95110" },
      location: POINT,
      ...overrides,
    });
  }

  beforeAll(async () => {
    db = createClient(TEST_URL!, TEST_KEY!, { auth: { persistSession: false } });
    customerId = await insert("users", { email: `schema-${run}@db.test`, password_hash: "x" });
    vehicleUserId = await insert("users", { email: `robot-${run}@db.test`, password_hash: "x", role: "VEHICLE" });
  });

  afterAll(async () => {
    if (!db) return;
    // Children first.
    for (const { table, id } of [...created].reverse()) await db.from(table).delete().eq("id", id);
  });

  it("allows one default address per customer", async () => {
    await insert("addresses", { customer_id: customerId, ...ADDRESS, is_default: true });
    await insert("addresses", { customer_id: customerId, ...ADDRESS, is_default: false });
    expect(await insertError("addresses", { customer_id: customerId, ...ADDRESS, is_default: true })).toMatch(
      /addresses_one_default_per_customer/,
    );
  });

  it("requires a two-letter state and a location on addresses", async () => {
    expect(await insertError("addresses", { customer_id: customerId, ...ADDRESS, state: "California" })).toMatch(/state/);
    const { location: _, ...noLocation } = ADDRESS;
    expect(await insertError("addresses", { customer_id: customerId, ...noLocation })).toMatch(/location/);
  });

  it("creates orders as PAID with the address and location snapshot required", async () => {
    const id = await newOrder();
    const { data } = await db.from("orders").select("status").eq("id", id).single();
    expect(data?.status).toBe("PAID");
    expect(await insertError("orders", { customer_id: customerId, location: POINT })).toMatch(/delivery_address/);
  });

  it.each(["PAID", "PREPARING", "BATCHED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELED"])(
    "accepts order status %s",
    async (status) => {
      await newOrder({ status });
    },
  );

  it.each(["PENDING_PAYMENT", "CANCELLED", "SHIPPED"])("rejects order status %s", async (status) => {
    expect(await insertError("orders", { customer_id: customerId, delivery_address: {}, location: POINT, status })).toMatch(
      /orders_status_check/,
    );
  });

  it("records order status history and rejects unknown statuses there", async () => {
    const orderId = await newOrder();
    await insert("order_status_history", { order_id: orderId, status: "PAID" });
    expect(await insertError("order_status_history", { order_id: orderId, status: "LOST" })).toMatch(/status/);
  });

  it("accepts the trip statuses routing needs and stores the route line", async () => {
    for (const status of ["PLANNED", "ROUTED", "OUT_FOR_DELIVERY", "COMPLETED", "ROUTE_FAILED"]) {
      await insert("trips", { status, order_count: 1, total_weight: 500 });
    }
    const geometry = { type: "LineString", coordinates: [[-121.88, 37.33], [-121.89, 37.34]] };
    const tripId = await insert("trips", { status: "ROUTED", route_geometry: geometry });
    const { data } = await db.from("trips").select("route_geometry").eq("id", tripId).single();
    expect(data?.route_geometry).toEqual(geometry);
    expect(await insertError("trips", { status: "DISPATCHED" })).toMatch(/trips_status_check/);
  });

  it("keeps the trip capacity limits", async () => {
    expect(await insertError("trips", { order_count: 11 })).toMatch(/order_count/);
    expect(await insertError("trips", { total_weight: 20001 })).toMatch(/total_weight/);
    await insert("trips", { order_count: 10, total_weight: 20000 });
  });

  it("lets an order be routed again on a later trip, but only once per trip", async () => {
    const orderId = await newOrder();
    const first = await insert("trips", { status: "ROUTE_FAILED" });
    const second = await insert("trips", { status: "ROUTED" });
    const stop = { order_id: orderId, stop_sequence: 1, location: POINT };
    await insert("delivery_stops", { trip_id: first, ...stop });
    await insert("delivery_stops", { trip_id: second, ...stop, estimated_arrival: new Date().toISOString() });
    expect(await insertError("delivery_stops", { trip_id: second, ...stop, stop_sequence: 2 })).toMatch(
      /delivery_stops_trip_id_order_id_key/,
    );
  });

  it("accepts the stop statuses robots report", async () => {
    const orderId = await newOrder();
    const tripId = await insert("trips", { status: "OUT_FOR_DELIVERY" });
    const statuses = ["PENDING", "EN_ROUTE", "ARRIVED", "DELIVERED", "DELAYED", "FAILED"];
    const stopId = await insert("delivery_stops", { trip_id: tripId, order_id: orderId, stop_sequence: 1, location: POINT });
    for (const status of statuses) {
      const { error } = await db.from("delivery_stops").update({ status }).eq("id", stopId);
      expect(error).toBeNull();
    }
    const { error } = await db.from("delivery_stops").update({ status: "COMPLETED" }).eq("id", stopId);
    expect(error?.message).toMatch(/delivery_stops_status_check/);
  });

  it("links one vehicle per robot account and bounds battery to 0-100", async () => {
    await insert("vehicles", { user_id: vehicleUserId, status: "AVAILABLE", battery_percent: 100, last_location: POINT });
    expect(await insertError("vehicles", { user_id: vehicleUserId })).toMatch(/vehicles_user_id_key/);
    expect(await insertError("vehicles", { user_id: customerId, battery_percent: 101 })).toMatch(/battery_percent/);
    expect(await insertError("vehicles", { user_id: customerId, status: "BROKEN" })).toMatch(/status/);
  });

  it("makes payment idempotency keys and provider IDs unique, and links one payment per order", async () => {
    const { data: cart } = await db.rpc("customer_get_or_create_cart", { p_customer_id: customerId });
    const orderId = await newOrder();
    const attempt = (key: string, extra: object = {}) => ({
      customer_id: customerId,
      cart_id: cart,
      idempotency_key: `${key}-${run}`,
      subtotal_cents: 1000,
      delivery_fee_cents: 0,
      tax_cents: 0,
      total_cents: 1000,
      ...extra,
    });
    await insert("payment_attempts", attempt("a", { provider_payment_id: `pi_a_${run}`, order_id: orderId }));
    expect(await insertError("payment_attempts", attempt("a"))).toMatch(/idempotency_key/);
    expect(await insertError("payment_attempts", attempt("b", { provider_payment_id: `pi_a_${run}` }))).toMatch(
      /provider_payment_id/,
    );
    expect(await insertError("payment_attempts", attempt("c", { order_id: orderId }))).toMatch(/payment_attempts_one_per_order/);
    expect(await insertError("payment_attempts", attempt("d", { status: "PAID" }))).toMatch(/status/);
  });

  it("only allows the known notification types and statuses", async () => {
    const orderId = await newOrder();
    const base = { order_id: orderId, customer_id: customerId, recipient_email: "a@b.co" };
    for (const type of ["ORDER_CONFIRMED", "READY_FOR_DELIVERY", "DELIVERY_UPDATE", "DELIVERED"]) {
      await insert("notifications", { ...base, notification_type: type });
    }
    expect(await insertError("notifications", { ...base, notification_type: "PROMO" })).toMatch(/notification_type/);
    expect(await insertError("notifications", { ...base, notification_type: "DELIVERED", status: "DONE" })).toMatch(/status/);
  });

  it("still runs the cart functions, and carts can only be ACTIVE or CHECKED_OUT", async () => {
    const { data: products } = await db.from("products").select("id").eq("is_active", true).gt("stock_quantity", 0).limit(1);
    if (!products?.length) return; // No seeded catalog in this database.
    const { data, error } = await db.rpc("customer_set_cart_item", {
      p_customer_id: customerId,
      p_product_id: products[0].id,
      p_quantity: 1,
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();

    const { data: cartId } = await db.rpc("customer_get_or_create_cart", { p_customer_id: customerId });
    expect((await db.from("carts").update({ status: "CHECKED_OUT" }).eq("id", cartId)).error).toBeNull();
    expect((await db.from("carts").update({ status: "CONVERTED" }).eq("id", cartId)).error?.message).toMatch(
      /carts_status_check/,
    );
  });
});
