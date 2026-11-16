import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecoveryDependencies } from "./recovery";
const provider = vi.hoisted(() => ({ paymentIntents: { search: vi.fn() } }));
vi.mock("./stripe", () => ({ createStripeClient: () => provider }));
try {
  process.loadEnvFile(".env.test.local");
}
catch { /* Optional local-only suite. */ }
const url = process.env.SUPABASE_TEST_URL, key = process.env.SUPABASE_TEST_SECRET_KEY;
if (url && !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(url)) {
  throw new Error("Separate local DB required");
}
describe.skipIf(!url || !key)("durable payment recovery against Postgres", () => {
  let db: SupabaseClient;
  const customer = randomUUID(), cart = randomUUID(), payment = randomUUID();
  async function update(values: object) {
    const { error } = await db.from("payment_attempts").update(values).eq("id", payment);
    if (error) {
      throw error;
    }
  }
  async function read() {
    const { data, error } = await db.from("payment_attempts").select("*").eq("id", payment).single();
    if (error) {
      throw error;
    }
    return data;
  }
  beforeAll(async () => {
    db = createClient(url!, key!, { auth: { persistSession: false } });
    for (const [table, row] of [
      ["users", {
          id: customer,
          email: `${customer}@recovery.test`,
          password_hash: "test-only",
          role: "CUSTOMER"
        }],
      ["carts", {
          id: cart,
          customer_id: customer
        }],
      ["payment_attempts", {
          id: payment,
          customer_id: customer,
          cart_id: cart,
          idempotency_key: payment,
          subtotal_cents: 100,
          delivery_fee_cents: 0,
          tax_cents: 5,
          total_cents: 105
        }],
    ] as const) {
      const { error } = await db.from(table).insert(row);
      if (error) {
        throw error;
      }
    }
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await update({
      provider_payment_id: null,
      recovery_manual: false,
      recovery_attempts: 0,
      recovery_next_at: "1970-01-01T00:00:00Z",
      recovery_until: null,
      recovery_token: null,
      created_at: "2000-01-01T00:00:00Z",
      recovery_error_code: null,
      processing_until: null
    });
    provider.paymentIntents.search.mockResolvedValue({
      data: [{
          id: `pi_${payment}`,
          metadata: { attemptId: payment },
          amount: 105,
          currency: "usd",
          capture_method: "manual",
          livemode: false
        }],
      has_more: false
    });
  });
  afterAll(async () => {
    if (!db) {
      return;
    }
    for (const [table, column, id] of [["payment_attempts", "id", payment], ["carts", "id", cart], ["users", "id", customer]]) {
      const { error } = await db.from(table).delete().eq(column, id);
      if (error) {
        throw error;
      }
    }
  });
  it("finds and verifies an old unlinked provider intent without creating anything at Stripe", async () => {
    const deps = createRecoveryDependencies(db);
    const [claimed] = await deps.claim(1);
    expect(claimed.id).toBe(payment);
    await deps.recoverProviderLink(claimed);
    expect((await read()).provider_payment_id).toBe(`pi_${payment}`);
    expect(provider.paymentIntents.search).toHaveBeenCalledWith({
      query: `metadata['attemptId']:'${payment}'`,
      limit: 2
    });
  });
  it.each(["missing", "ambiguous", "mismatched"])("does not attach %s provider matches", async (kind) => {
    const candidate = {
      id: `pi_${payment}`,
      metadata: { attemptId: payment },
      amount: 105,
      currency: "usd",
      capture_method: "manual",
      livemode: false
    };
    provider.paymentIntents.search.mockResolvedValue({
      data: kind === "missing" ? [] : kind === "ambiguous" ? [candidate, candidate] : [{
          ...candidate,
          amount: 999
        }],
      has_more: false
    });
    const deps = createRecoveryDependencies(db);
    const [claimed] = await deps.claim(1);
    await expect(deps.recoverProviderLink(claimed)).rejects.toThrow();
    expect((await read()).provider_payment_id).toBeNull();
  });
  it("stops failed automatic retries at eight and makes them visible for manual recovery", async () => {
    await update({ recovery_attempts: 7 });
    const deps = createRecoveryDependencies(db);
    const [claimed] = await deps.claim(1);
    await deps.finish(claimed, "FAILED", "PAYMENT_NOT_LINKED");
    expect(await read()).toMatchObject({
      recovery_attempts: 8,
      recovery_manual: true,
      recovery_error_code: "PAYMENT_NOT_LINKED",
      recovery_token: null
    });
  });
  it("bounds crashed leases and does not reclaim an exhausted attempt", async () => {
    await update({
      recovery_attempts: 8,
      recovery_until: "2000-01-01T00:00:00Z"
    });
    const claimed = await createRecoveryDependencies(db).claim(1);
    expect(claimed.map(row => row.id)).not.toContain(payment);
    expect((await read()).recovery_manual).toBe(true);
  });
  it("rejects stale lease acknowledgements after reclamation", async () => {
    const deps = createRecoveryDependencies(db);
    const [old] = await deps.claim(1);
    await update({
      recovery_until: "2000-01-01T00:00:00Z",
      recovery_next_at: "1970-01-01T00:00:00Z"
    });
    const [current] = await deps.claim(1);
    expect(current.recovery_token).not.toBe(old.recovery_token);
    await expect(deps.finish(old, "COMPLETED", null)).rejects.toThrow();
    await deps.finish(current, "WAITING", null);
    expect(await read()).toMatchObject({
      recovery_attempts: 0,
      recovery_manual: false,
      recovery_token: null
    });
  });
});
