import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { hashSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { getOwnedAddress } from "@/lib/auth/addresses";

// Unlike unit tests, this suite calls the real route, session lookup, service
// helpers, and address RPC. Use a separate LOCAL database with migrations applied;
// fixtures are written and deleted, so never target a demo database.
try { process.loadEnvFile(".env.test.local"); } catch { /* Optional test-only configuration. */ }
const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_SECRET_KEY;
if (url && !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(url)) {
  throw new Error("Checkout DB tests require a local test database.");
}

describe.skipIf(!url || !key)("checkout preview against Postgres/PostGIS", () => {
  let db: SupabaseClient;
  // Unique fixture IDs avoid collisions with other suites and bound cleanup to
  // this run. A second customer makes cross-customer address checks meaningful.
  const customer = randomUUID(), other = randomUUID(), category = randomUUID(), product = randomUUID();
  const cart = randomUUID(), address = randomUUID(), otherAddress = randomUUID();
  const token = randomBytes(32).toString("hex");
  const expected = { subtotalCents: 500, totalWeight: 2000, deliveryFeeCents: 1000, taxCents: 25, totalCents: 1525 };

  async function insert(table: string, rows: object | object[]) {
    const { error } = await db.from(table).insert(rows);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  async function update(table: string, id: string, values: object) {
    const { error } = await db.from(table).update(values).eq("id", id);
    if (error) throw new Error(error.message);
  }
  async function call(addressId = address, totals = expected, cookie = token) {
    return POST(new NextRequest("http://localhost/api/checkout/preview", {
      method: "POST", headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${cookie}` },
      body: JSON.stringify({ addressId, expected: totals, customerId: other }),
    }));
  }
  async function count(table: string, column: string, id: string) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).eq(column, id);
    if (error) throw error;
    return count;
  }

  beforeAll(async () => {
    db = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url!);
    vi.stubEnv("SUPABASE_SECRET_KEY", key!);
    vi.stubEnv("OFS_STORE_LATITUDE", "0");
    vi.stubEnv("OFS_STORE_LONGITUDE", "0");
    vi.stubEnv("OFS_DELIVERY_RADIUS_METERS", "1000");
    await insert("users", [customer, other].map((id) => ({ id, email: `${id}@checkout.test`, password_hash: "test-only", role: "CUSTOMER" })));
    await insert("auth_sessions", { user_id: customer, token_hash: hashSessionToken(token), expires_at: new Date(Date.now() + 3600000).toISOString() });
    await insert("categories", { id: category, name: "Checkout test", slug: category });
    await insert("products", { id: product, category_id: category, sku: product, name: "Test product", price_cents: 250, unit_weight: 1000, stock_quantity: 2 });
    await insert("carts", { id: cart, customer_id: customer });
    await insert("cart_items", { cart_id: cart, product_id: product, quantity: 2 });
    await insert("addresses", [{ id: address, customer_id: customer }, { id: otherAddress, customer_id: other }].map((a) => ({
      ...a, line_1: "Test address", city: "Test", state: "CA", postal_code: "00000", location: "SRID=4326;POINT(0 0)",
    })));
  });

  beforeEach(async () => {
    // Each scenario changes stored data; restore the shared fixture baseline
    // before the next scenario so failures do not depend on test ordering.
    await update("products", product, { is_active: true, price_cents: 250, unit_weight: 1000, stock_quantity: 2 });
    await update("categories", category, { is_active: true });
    await update("addresses", address, { location: "SRID=4326;POINT(0 0)" });
    await update("carts", cart, { status: "ACTIVE" });
  });

  afterAll(async () => {
    try {
      if (db) {
        // Only this suite's UUID fixtures; never reset or seed the database.
        for (const [table, column, ids] of [
          ["carts", "customer_id", [customer, other]], ["addresses", "customer_id", [customer, other]],
          ["products", "id", [product]], ["categories", "id", [category]], ["users", "id", [customer, other]],
        ] as const) {
          const { error } = await db.from(table).delete().in(column, [...ids]);
          if (error) throw error;
        }
      }
    } finally { vi.unstubAllEnvs(); }
  });

  it("returns a real authenticated preview without changing cart, stock, payments or orders", async () => {
    const before = await db.from("carts").select("*").eq("id", cart).single();
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ...expected, taxPolicy: { excludesDelivery: true } });
    expect((await db.from("carts").select("*").eq("id", cart).single()).data).toEqual(before.data);
    expect((await db.from("cart_items").select("quantity").eq("cart_id", cart).single()).data?.quantity).toBe(2);
    expect((await db.from("products").select("stock_quantity").eq("id", product).single()).data?.stock_quantity).toBe(2);
    expect(await count("orders", "customer_id", customer)).toBe(0);
    expect(await count("payment_attempts", "customer_id", customer)).toBe(0);
  });
  it("does not create a replacement cart when no active cart exists", async () => {
    await update("carts", cart, { status: "CHECKED_OUT" });
    expect((await call()).status).toBe(422);
    expect(await count("carts", "customer_id", customer)).toBe(1);
  });
  it("does not reveal another customer's address", async () => {
    expect(await getOwnedAddress(db, customer, otherAddress)).toBeNull();
    const foreign = await call(otherAddress), missing = await call(randomUUID());
    expect(foreign.status).toBe(422);
    expect(await foreign.json()).toEqual(await missing.json());
  });
  it("rejects expired/missing sessions", async () => {
    expect((await call(address, expected, "unknown")).status).toBe(401);
    const expired = randomBytes(32).toString("hex");
    await insert("auth_sessions", { user_id: customer, token_hash: hashSessionToken(expired), expires_at: new Date(0).toISOString() });
    expect((await call(address, expected, expired)).status).toBe(401);
  });
  it("rejects a category retired after the item was added", async () => {
    await update("categories", category, { is_active: false });
    expect(await (await call()).json()).toMatchObject({ error: { code: "PRODUCT_UNAVAILABLE" } });
  });
  it("rejects changed stock and prices", async () => {
    await update("products", product, { stock_quantity: 1 });
    expect(await (await call()).json()).toMatchObject({ error: { code: "INSUFFICIENT_STOCK" } });
    await update("products", product, { stock_quantity: 2, price_cents: 300 });
    expect(await (await call()).json()).toMatchObject({ error: { code: "TOTALS_MISMATCH" }, current: { totalCents: 1630 } });
  });
  it("checks real PostGIS coordinates and fails closed without area configuration", async () => {
    await update("addresses", address, { location: "SRID=4326;POINT(1 0)" });
    expect(await (await call()).json()).toMatchObject({ error: { code: "ADDRESS_INVALID" } });
    vi.stubEnv("OFS_DELIVERY_RADIUS_METERS", "");
    try { expect((await call()).status).toBe(503); }
    finally { vi.stubEnv("OFS_DELIVERY_RADIUS_METERS", "1000"); }
  });
  it.each([1999, 2000, 19999, 20000, 20001])("enforces weight boundary %i through the route", async (weight) => {
    // Use one unit to express every exact boundary in hundredths of a pound.
    const { error } = await db.from("cart_items").update({ quantity: 1 }).eq("cart_id", cart);
    if (error) throw error;
    try {
      await update("products", product, { unit_weight: weight });
      const fee = weight >= 2000 ? 1000 : 0;
      const response = await call(address, { subtotalCents: 250, totalWeight: weight, deliveryFeeCents: fee, taxCents: 13, totalCents: 263 + fee });
      expect(response.status).toBe(weight > 20000 ? 422 : 200);
      if (weight > 20000) expect(await response.json()).toMatchObject({ error: { code: "CART_OVERWEIGHT" } });
    } finally {
      const { error: restoreError } = await db.from("cart_items").update({ quantity: 2 }).eq("cart_id", cart);
      if (restoreError) throw restoreError;
    }
  });
});
