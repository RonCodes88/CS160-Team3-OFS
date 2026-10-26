import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { verifyPaymentWebhook } from "./webhook";

// Use Stripe's real signature verifier with synthetic payloads; no network calls.
const webhooks = new Stripe("sk_test_fixture").webhooks;
const secret = "whsec_test_fixture";
const event = { id: "evt_test", object: "event", livemode: false,
  type: "payment_intent.amount_capturable_updated",
  data: { object: { id: "pi_test", object: "payment_intent", livemode: false, client_secret: "never-return-this" } } };
const sign = (payload: string, timestamp?: number) => webhooks.generateTestHeaderString({ payload, secret, timestamp });
const verify = (value: unknown = event) => {
  const body = JSON.stringify(value);
  return verifyPaymentWebhook(webhooks, body, sign(body), secret);
};

describe("Stripe payment webhook verification", () => {
  it.each(["payment_intent.amount_capturable_updated", "payment_intent.succeeded", "payment_intent.payment_failed", "payment_intent.canceled"])(
    "accepts signed test event %s and returns identifiers only", (type) => {
      expect(verify({ ...event, type })).toEqual({ eventId: "evt_test", type, paymentIntentId: "pi_test" });
    },
  );
  it("rejects body changes after signing", () => {
    const body = JSON.stringify(event);
    expect(() => verifyPaymentWebhook(webhooks, body + " ", sign(body), secret)).toThrow("Invalid Stripe webhook signature or payload.");
  });
  it("rejects signatures from a different endpoint", () => {
    const body = JSON.stringify(event);
    expect(() => verifyPaymentWebhook(webhooks, body, sign(body), "whsec_wrong")).toThrow("Invalid Stripe webhook signature or payload.");
  });
  it("rejects expired signatures", () => {
    const body = JSON.stringify(event);
    expect(() => verifyPaymentWebhook(webhooks, body, sign(body, Math.floor(Date.now() / 1000) - 600), secret)).toThrow("Invalid Stripe webhook signature or payload.");
  });
  it("rejects a missing signature", () => {
    expect(() => verifyPaymentWebhook(webhooks, JSON.stringify(event), null, secret)).toThrow("Stripe-Signature is required.");
  });
  it.each([undefined, "sk_test_wrong"]) ("reports missing or invalid webhook configuration", (key) => {
    const body = JSON.stringify(event);
    expect(() => verifyPaymentWebhook(webhooks, body, sign(body), key)).toThrow("Stripe webhook verification is not configured.");
  });
  it("rejects signed malformed JSON", () => {
    expect(() => verifyPaymentWebhook(webhooks, "{", sign("{"), secret)).toThrow("Invalid Stripe webhook signature or payload.");
  });
  it("rejects live-mode events", () => {
    expect(() => verify({ ...event, livemode: true })).toThrow("Only Stripe test events are accepted.");
  });
  it("rejects invalid PaymentIntent data", () => {
    expect(() => verify({ ...event, data: { object: { id: "ch_wrong", object: "charge" } } })).toThrow("Invalid payment event payload.");
  });
  it("ignores unrelated events only after signature verification", () => {
    const unrelated = { ...event, type: "customer.created" };
    expect(verify(unrelated)).toBeNull();
    expect(() => verifyPaymentWebhook(webhooks, JSON.stringify(unrelated), "bad", secret)).toThrow("Invalid Stripe webhook signature or payload.");
  });
});
