import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCustomerOrder, getOrderSummary } from "@/lib/orders/read";

// Runs the order read against a LOCAL Supabase with the migrations applied.
// Setup: `npx supabase start`, then put SUPABASE_TEST_URL and
// SUPABASE_TEST_SECRET_KEY in .env.test.local. Skipped when not configured.
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
const ADDRESS = { line_1: "211 S 1st St", city: "San Jose", state: "CA", postal_code: "95113" };

describe.skipIf(!TEST_URL || !TEST_KEY)("getOrderSummary against Postgres", () => {
  let db: SupabaseClient;
  let customerId: string;
  let categoryId: string;
  let productId: string;
  let orderId: string;

  async function insertOne<T>(table: string, row: object): Promise<T> {
    const { data, error } = await db.from(table).insert(row).select().single();
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
    return data as T;
  }

  beforeAll(async () => {
    db = createClient(TEST_URL!, TEST_KEY!, { auth: { persistSession: false } });
    customerId = (await insertOne<{ id: string }>("users", { email: `orders-${run}@test.local`, password_hash: "test-only" })).id;
    categoryId = (await insertOne<{ id: string }>("categories", { name: `Orders ${run}`, slug: `orders-${run}` })).id;
    productId = (
      await insertOne<{ id: string }>("products", {
        sku: `MILK-${run}`,
        category_id: categoryId,
        name: "Whole Milk",
        price_cents: 449,
        unit_weight: 860,
      })
    ).id;
    orderId = (
      await insertOne<{ id: string }>("orders", {
        customer_id: customerId,
        delivery_address: ADDRESS,
        location: "SRID=4326;POINT(-121.8863 37.3382)",
        subtotal_cents: 898,
        total_cents: 898,
        total_weight: 1720,
      })
    ).id;
    await insertOne("order_items", {
      order_id: orderId,
      product_id: productId,
      sku: `MILK-${run}`,
      product_name: "Whole Milk",
      unit_price_cents: 449,
      unit_weight: 860,
      quantity: 2,
    });
  });

  afterAll(async () => {
    if (!db) return;
    if (orderId) await db.from("orders").delete().eq("id", orderId); // items cascade
    if (productId) await db.from("products").delete().eq("id", productId);
    if (categoryId) await db.from("categories").delete().eq("id", categoryId);
    if (customerId) await db.from("users").delete().eq("id", customerId);
  });

  it("reads the order's checkout snapshot with its items", async () => {
    expect(await getOrderSummary(db, orderId)).toEqual({
      id: orderId,
      subtotalCents: 898,
      deliveryFeeCents: 0,
      taxCents: 0,
      totalCents: 898,
      deliveryAddress: ADDRESS,
      items: [{ productName: "Whole Milk", quantity: 2, unitPriceCents: 449 }],
    });
  });

  it("returns null for an order that does not exist", async () => {
    expect(await getOrderSummary(db, randomUUID())).toBeNull();
  });

  it("reads a customer's own order with its status and weight", async () => {
    expect(await getCustomerOrder(db, customerId, orderId)).toMatchObject({
      id: orderId,
      status: "PAID",
      totalWeight: 1720,
      totalCents: 898,
      items: [{ productName: "Whole Milk", quantity: 2, unitPriceCents: 449 }],
    });
  });

  it("hides another customer's order", async () => {
    expect(await getCustomerOrder(db, randomUUID(), orderId)).toBeNull();
  });
});
