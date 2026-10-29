import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { createStripeClient, createAuthorizationIntent } from "./stripe";

const attemptId = "332a8981-a47f-4caa-a404-8764a29f5bd4";

describe("Stripe authorization adapter", () => {
  it.each([undefined, "", "sk_live_example", "pk_test_example"])("rejects invalid or live secret %s", (key) => {
    expect(() => createStripeClient(key)).toThrow("Stripe test secret key is required");
  });

  it("accepts a test secret without making a request", () => {
    expect(createStripeClient("sk_test_example")).toBeInstanceOf(Stripe);
  });

  it("creates a card authorization using cents and a stable attempt key", async () => {
    const create = vi.fn().mockResolvedValue({ id: "pi_test", client_secret: "secret", status: "requires_payment_method" });
    const result = await createAuthorizationIntent({ create }, { attemptId, totalCents: 2525 });
    expect(create).toHaveBeenCalledWith({
      amount: 2525, currency: "usd", capture_method: "manual",
      allowed_payment_method_types: ["card"], metadata: { attemptId },
    }, { idempotencyKey: `ofs:payment-intent:${attemptId}` });
    expect(result.status).toBe("requires_payment_method");
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid amount %s before calling Stripe", async (totalCents) => {
    const create = vi.fn();
    await expect(createAuthorizationIntent({ create }, { attemptId, totalCents })).rejects.toThrow(RangeError);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an empty attempt ID", async () => {
    const create = vi.fn();
    await expect(createAuthorizationIntent({ create }, { attemptId: "", totalCents: 100 })).rejects.toThrow("Invalid payment attempt ID");
    expect(create).not.toHaveBeenCalled();
  });

  it("preserves provider failures for the service to handle", async () => {
    const error = new Error("provider unavailable");
    const create = vi.fn().mockRejectedValue(error);
    await expect(createAuthorizationIntent({ create }, { attemptId, totalCents: 100 })).rejects.toBe(error);
  });
});
