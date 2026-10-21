import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { hashSessionToken, SESSION_COOKIE } from "@/lib/auth/session";

const provider = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn() }));
vi.mock("@/lib/payments/stripe", async (original) => ({
  ...await original<typeof import("@/lib/payments/stripe")>(),
  createStripeClient: () => ({ paymentIntents: provider }),
}));
try { process.loadEnvFile(".env.test.local"); } catch { /* Optional local test configuration. */ }
const url = process.env.SUPABASE_TEST_URL, key = process.env.SUPABASE_TEST_SECRET_KEY;
if (url && !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(url)) {
  throw new Error("Payment DB tests require a separate local database.");
}

describe.skipIf(!url || !key)("payment intents against Postgres (Stripe mocked)", () => {
  let db: SupabaseClient;
  const customer = randomUUID(), other = randomUUID(), product = randomUUID(), category = randomUUID();
  const cart = randomUUID(), address = randomUUID(), foreignAddress = randomUUID();
  const token = randomBytes(32).toString("hex");
  const expected = { subtotalCents: 500, totalWeight: 2000, deliveryFeeCents: 1000, taxCents: 25, totalCents: 1525 };
  async function write(table: string, rows: object | object[]) {
    const { error } = await db.from(table).insert(rows); if (error) throw error;
  }
  async function call(requestKey = "first", addressId = address, totals = expected) {
    return POST(new NextRequest("http://localhost/api/checkout/payment-intent", { method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": requestKey, cookie: `${SESSION_COOKIE}=${token}` },
      body: JSON.stringify({ addressId, expected: totals, customerId: other }),
    }));
  }
  async function attempts() {
    const { data, error } = await db.from("payment_attempts").select("*").eq("customer_id", customer);
    if (error) throw error; return data!;
  }
  beforeAll(async () => {
    db = createClient(url!, key!, { auth: { persistSession: false } });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url!); vi.stubEnv("SUPABASE_SECRET_KEY", key!);
    vi.stubEnv("OFS_STORE_LATITUDE", "0"); vi.stubEnv("OFS_STORE_LONGITUDE", "0"); vi.stubEnv("OFS_DELIVERY_RADIUS_METERS", "1000");
    await write("users", [customer, other].map((id) => ({ id, email: `${id}@payment.test`, password_hash: "test-only", role: "CUSTOMER" })));
    await write("auth_sessions", { user_id: customer, token_hash: hashSessionToken(token), expires_at: new Date(Date.now() + 3600_000).toISOString() });
    await write("categories", { id: category, name: "Payment test", slug: category });
    await write("products", { id: product, category_id: category, sku: product, name: "Test", price_cents: 250, unit_weight: 1000, stock_quantity: 2 });
    await write("carts", { id: cart, customer_id: customer });
    await write("cart_items", { cart_id: cart, product_id: product, quantity: 2 });
    await write("addresses", [{ id: address, customer_id: customer }, { id: foreignAddress, customer_id: other }].map((a) => ({
      ...a, line_1: "Test", city: "Test", state: "CA", postal_code: "00000", location: "SRID=4326;POINT(0 0)",
    })));
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    const { error } = await db.from("payment_attempts").delete().eq("customer_id", customer); if (error) throw error;
    const updated = await db.from("products").update({ stock_quantity: 2, price_cents: 250 }).eq("id", product); if (updated.error) throw updated.error;
    provider.create.mockImplementation(async (params) => ({ id: `pi_${params.metadata.attemptId}`, client_secret: "test-client-secret",
      status: "requires_payment_method", amount: params.amount, currency: "usd", livemode: false,
      capture_method: "manual", metadata: params.metadata }));
    provider.retrieve.mockImplementation(async (id) => ({ id, client_secret: "test-client-secret", status: "requires_payment_method",
      amount: 1525, currency: "usd", livemode: false, capture_method: "manual", metadata: { attemptId: id.slice(3) } }));
  });
  afterAll(async () => {
    try {
      if (db) for (const [table, column, ids] of [
        ["payment_attempts", "customer_id", [customer]], ["carts", "customer_id", [customer]],
        ["addresses", "customer_id", [customer, other]], ["products", "id", [product]],
        ["categories", "id", [category]], ["users", "id", [customer, other]],
      ] as const) {
        const { error } = await db.from(table).delete().in(column, [...ids]); if (error) throw error;
      }
    } finally { vi.unstubAllEnvs(); }
  });

  it("persists the owned cart/address/quote without storing a client secret or creating an order", async () => {
    const response = await call(); expect(response.status).toBe(200);
    const rows = await attempts(); expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ customer_id: customer, cart_id: cart, address_id: address, total_cents: 1525,
      status: "PENDING", checkout_snapshot: { totals: expected } });
    expect(JSON.stringify(rows)).not.toContain("test-client-secret");
    expect((await db.from("products").select("stock_quantity").eq("id", product).single()).data?.stock_quantity).toBe(2);
    expect((await db.from("carts").select("status").eq("id", cart).single()).data?.status).toBe("ACTIVE");
    expect((await db.from("orders").select("id").eq("customer_id", customer)).data).toEqual([]);
  });
  it("reuses one database attempt and provider key under concurrent identical requests", async () => {
    const responses = await Promise.all([call(), call(), call()]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(new Set(bodies.map((b) => b.attemptId)).size).toBe(1);
    expect(await attempts()).toHaveLength(1);
    const keys = provider.create.mock.calls.map((c) => c[1].idempotencyKey);
    expect(new Set(keys).size).toBe(1);
  });
  it("prevents simultaneous attempts with different keys on one cart", async () => {
    const responses = await Promise.all([call("key-a"), call("key-b")]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await attempts()).toHaveLength(1); expect(provider.create).toHaveBeenCalledTimes(1);
  });
  it("rejects a foreign address before creating an attempt", async () => {
    expect((await call("key", foreignAddress)).status).toBe(422);
    expect(await attempts()).toHaveLength(0); expect(provider.create).not.toHaveBeenCalled();
  });
  it("rejects changed totals on reuse", async () => {
    expect((await call()).status).toBe(200);
    const response = await call("first", address, { ...expected, totalCents: 1 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT" } });
  });
  it("rechecks stock before returning a resumable intent", async () => {
    expect((await call()).status).toBe(200);
    const { error } = await db.from("products").update({ stock_quantity: 0 }).eq("id", product); if (error) throw error;
    const response = await call(); expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "INSUFFICIENT_STOCK" } });
    expect(provider.retrieve).not.toHaveBeenCalled();
  });
  it("recovers a provider timeout using the original attempt", async () => {
    provider.create.mockRejectedValueOnce(new Error("timeout"));
    expect((await call()).status).toBe(503);
    expect((await call()).status).toBe(200); expect(await attempts()).toHaveLength(1);
    expect(provider.create.mock.calls[0][1]).toEqual(provider.create.mock.calls[1][1]);
  });
  it("rejects attaching another customer's provider ID", async () => {
    await call(); const [row] = await attempts();
    const result = await db.rpc("checkout_attach_payment_intent", { p_customer_id: other, p_attempt_id: row.id, p_provider_id: "pi_foreign" });
    expect(result.error?.code).toBe("P0011");
    expect((await attempts())[0].provider_payment_id).toBe(row.provider_payment_id);
  });
  it("rejects a different provider ID once an attempt is linked", async () => {
    expect((await call()).status).toBe(200); const [row] = await attempts();
    const result = await db.rpc("checkout_attach_payment_intent", { p_customer_id: customer, p_attempt_id: row.id, p_provider_id: "pi_replacement" });
    expect(result.error?.code).toBe("P0011");
  });
  it("cannot reserve a payment against another customer's cart", async () => {
    expect((await call()).status).toBe(200); const [row] = await attempts();
    const result = await db.rpc("checkout_reserve_payment_attempt", { p_attempt: { ...row, customer_id: other, idempotency_key: "foreign" } });
    expect(result.error?.code).toBe("P0011");
  });
});
