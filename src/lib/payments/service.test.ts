import { describe, expect, it, vi } from "vitest";
import { startPayment, PaymentError, type PaymentDependencies, type PaymentAttempt, type PaymentQuote } from "./service";

const input = { addressId: "address", expected: { subtotalCents: 500, totalWeight: 100, deliveryFeeCents: 0, taxCents: 25, totalCents: 525 } };
const quote: PaymentQuote = { cartId: "cart", addressId: "address", location: { lat: 0, lng: 0 },
  items: [{ productId: "product", quantity: 2, unitPriceCents: 250, unitWeight: 50 }], totals: input.expected };

function fixture() {
  let saved: PaymentAttempt | null = null;
  const provider = { id: "pi_test", client_secret: "client-secret", amount: 525, currency: "usd", livemode: false,
    capture_method: "manual", status: "requires_payment_method", metadata: { attemptId: "attempt" } };
  const deps: PaymentDependencies = {
    loadQuote: vi.fn().mockResolvedValue(quote),
    find: vi.fn(async () => saved),
    reserve: vi.fn(async (record) => saved = { ...record, id: "attempt", provider_payment_id: null,
      status: "PENDING", created_at: new Date().toISOString() }),
    attach: vi.fn(async () => { saved!.provider_payment_id = provider.id; }),
    create: vi.fn().mockResolvedValue(provider), retrieve: vi.fn().mockResolvedValue(provider),
  };
  return { deps, provider, saved: () => saved!, run: (body = input, key = "key") => startPayment("customer", key, body, deps) };
}

describe("payment intent orchestration", () => {
  it("persists validated totals before contacting Stripe and returns only the payment contract", async () => {
    const f = fixture();
    expect(await f.run()).toEqual({ attemptId: "attempt", paymentIntentId: "pi_test", clientSecret: "client-secret", status: "requires_payment_method" });
    expect(f.saved().checkout_snapshot).toEqual(quote);
    expect(f.deps.create).toHaveBeenCalledWith({ attemptId: "attempt", totalCents: 525 });
    expect(vi.mocked(f.deps.reserve).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.deps.create).mock.invocationCallOrder[0]);
    expect(JSON.stringify(f.saved())).not.toContain("client-secret");
  });
  it("same key retrieves the existing provider intent without creating again", async () => {
    const f = fixture(); await f.run(); await f.run();
    expect(f.deps.create).toHaveBeenCalledTimes(1);
    expect(f.deps.retrieve).toHaveBeenCalledWith("pi_test");
  });
  it("replays a processed attempt even when its old cart is no longer active", async () => {
    const f = fixture(); await f.run(); f.saved().status = "CAPTURED"; f.provider.status = "succeeded";
    vi.mocked(f.deps.loadQuote).mockRejectedValue(new Error("Cart checked out"));
    expect(await f.run()).toMatchObject({ attemptId: "attempt", status: "succeeded", clientSecret: null });
    expect(f.deps.loadQuote).toHaveBeenCalledTimes(1);
  });
  it.each([0, 49, 100_000_000])("rejects unsupported USD amount %s without persisting", async (totalCents) => {
    const f = fixture(); vi.mocked(f.deps.loadQuote).mockResolvedValue({ ...quote, totals: { ...quote.totals, totalCents } });
    await expect(f.run()).rejects.toMatchObject({ code: "PAYMENT_AMOUNT_UNSUPPORTED" });
    expect(f.deps.reserve).not.toHaveBeenCalled();
  });
  it("scopes the idempotency lookup to the customer", async () => {
    const f = fixture(); await f.run(); const first = vi.mocked(f.deps.find).mock.calls[0][1];
    vi.mocked(f.deps.find).mockResolvedValue(null);
    await startPayment("another-customer", "key", input, f.deps);
    expect(vi.mocked(f.deps.find).mock.calls[1][1]).not.toBe(first);
  });
  it("rejects reuse with changed totals or address", async () => {
    const f = fixture(); await f.run();
    await expect(f.run({ ...input, addressId: "another" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(f.run({ ...input, expected: { ...input.expected, totalCents: 600 } })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(f.deps.create).toHaveBeenCalledTimes(1);
  });
  it("never contacts Stripe if current checkout validation fails", async () => {
    const f = fixture(); vi.mocked(f.deps.loadQuote).mockRejectedValue(new PaymentError(409, "INSUFFICIENT_STOCK", "Stock changed."));
    await expect(f.run()).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect(f.deps.reserve).not.toHaveBeenCalled(); expect(f.deps.create).not.toHaveBeenCalled();
  });
  it("rejects a changed item snapshot even if aggregate totals are unchanged", async () => {
    const f = fixture(); await f.run();
    vi.mocked(f.deps.loadQuote).mockResolvedValue({ ...quote, items: [{ ...quote.items[0], productId: "replacement" }] });
    await expect(f.run()).rejects.toMatchObject({ code: "CHECKOUT_CHANGED" });
    expect(f.deps.retrieve).not.toHaveBeenCalled();
  });
  it("retries an uncertain provider failure with the same persisted attempt", async () => {
    const f = fixture(); vi.mocked(f.deps.create).mockRejectedValueOnce(new Error("private provider details"));
    await expect(f.run()).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_UNAVAILABLE" });
    await f.run();
    expect(f.deps.reserve).toHaveBeenCalledTimes(1);
    expect(f.deps.create).toHaveBeenNthCalledWith(2, { attemptId: "attempt", totalCents: 525 });
  });
  it("recovers after saving the provider ID failed", async () => {
    const f = fixture(); vi.mocked(f.deps.attach).mockRejectedValueOnce(new Error("DB unavailable"));
    await expect(f.run()).rejects.toThrow("DB unavailable");
    await f.run(); expect(f.deps.reserve).toHaveBeenCalledTimes(1);
    expect(f.deps.create).toHaveBeenCalledTimes(2);
  });
  it("refuses to recreate an uncertain intent past Stripe's retention window", async () => {
    const f = fixture(); vi.mocked(f.deps.create).mockRejectedValueOnce(new Error("timeout"));
    await expect(f.run()).rejects.toThrow();
    f.saved().created_at = new Date(Date.now() - 24 * 3600_000).toISOString();
    await expect(f.run()).rejects.toMatchObject({ code: "PAYMENT_RECONCILIATION_REQUIRED" });
    expect(f.deps.create).toHaveBeenCalledTimes(1);
  });
  it.each([{ livemode: true }, { amount: 999 }, { currency: "eur" }, { capture_method: "automatic" }, { metadata: { attemptId: "other" } }])(
    "rejects inconsistent provider response %j", async (change) => {
      const f = fixture(); Object.assign(f.provider, change);
      await expect(f.run()).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_MISMATCH" });
      expect(f.deps.attach).not.toHaveBeenCalled();
    },
  );
  it("does not expose the client secret after authorization", async () => {
    const f = fixture(); f.provider.status = "requires_capture";
    expect(await f.run()).toMatchObject({ status: "requires_capture", clientSecret: null });
  });
  it("propagates a competing-attempt conflict without calling Stripe", async () => {
    const f = fixture(); vi.mocked(f.deps.reserve).mockRejectedValue(new PaymentError(409, "PAYMENT_IN_PROGRESS", "Existing payment."));
    await expect(f.run()).rejects.toMatchObject({ code: "PAYMENT_IN_PROGRESS" });
    expect(f.deps.create).not.toHaveBeenCalled();
  });
});
