import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { sendNotificationsAfterResponse } from "@/lib/notifications/service";
import { finalizeWebhookPayment } from "@/lib/payments/finalize-backend";
import { PaymentError } from "@/lib/payments/service";

vi.mock("@/lib/notifications/service", () => ({ sendNotificationsAfterResponse: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/payments/finalize-backend", () => ({ finalizeWebhookPayment: vi.fn() }));
const secret = "whsec_fixture";
const event = { id: "evt_test", type: "payment_intent.amount_capturable_updated", livemode: false,
  data: { object: { id: "pi_test", object: "payment_intent", livemode: false, metadata: { customerId: "forged", attemptId: "attempt" } } } };
const call = (value: unknown = event, valid = true) => {
  const body = JSON.stringify(value);
  return POST(new Request("http://localhost/api/webhooks/stripe", { method: "POST", body,
    headers: { "Stripe-Signature": valid ? Stripe.webhooks.generateTestHeaderString({ payload: body, secret }) : "invalid" } }));
};
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
  vi.mocked(finalizeWebhookPayment).mockResolvedValue({ attemptId: "attempt", status: "CAPTURED", orderId: "order" });
});

describe("Stripe webhook endpoint", () => {
  it("passes only the verified provider ID to finalization, without customer cookies", async () => {
    expect((await call()).status).toBe(200);
    expect(finalizeWebhookPayment).toHaveBeenCalledWith({}, "pi_test");
  });
  it("sends notifications once the order exists", async () => {
    await call();
    expect(sendNotificationsAfterResponse).toHaveBeenCalledOnce();
  });
  it("sends nothing when the event creates no order", async () => {
    vi.mocked(finalizeWebhookPayment).mockResolvedValue({ attemptId: "attempt", status: "VOIDED" });
    await call();
    await call({ ...event, type: "customer.created" });
    expect(sendNotificationsAfterResponse).not.toHaveBeenCalled();
  });
  it("rejects invalid signatures before database processing", async () => {
    expect((await call(event, false)).status).toBe(400); expect(finalizeWebhookPayment).not.toHaveBeenCalled();
  });
  it("acknowledges unrelated signed events", async () => {
    expect((await call({ ...event, type: "customer.created" })).status).toBe(200);
    expect(finalizeWebhookPayment).not.toHaveBeenCalled();
  });
  it("acknowledges payments that OFS did not create without looking them up", async () => {
    const foreign = { ...event, data: { object: { ...event.data.object, metadata: {} } } };
    expect((await call(foreign)).status).toBe(200);
    expect(finalizeWebhookPayment).not.toHaveBeenCalled();
  });
  it("asks Stripe to retry a fresh event for a payment this database does not know yet", async () => {
    vi.mocked(finalizeWebhookPayment).mockRejectedValue(new PaymentError(503, "PAYMENT_NOT_LINKED", "Not ready."));
    const fresh = { ...event, created: Math.floor(Date.now() / 1000) };
    expect((await call(fresh)).status).toBe(503);
  });
  it("acknowledges an old event for a payment this database never knew, so Stripe stops retrying", async () => {
    vi.mocked(finalizeWebhookPayment).mockRejectedValue(new PaymentError(503, "PAYMENT_NOT_LINKED", "Not ready."));
    const old = { ...event, created: Math.floor(Date.now() / 1000) - 3600 };
    expect((await call(old)).status).toBe(200);
    expect(sendNotificationsAfterResponse).not.toHaveBeenCalled();
  });
  it("still retries an old event when the failure is anything else", async () => {
    vi.mocked(finalizeWebhookPayment).mockRejectedValue(new PaymentError(503, "PAYMENT_BUSY", "Retry."));
    expect((await call({ ...event, created: 1 })).status).toBe(503);
  });
  it("requests a retry while another worker holds the attempt", async () => {
    vi.mocked(finalizeWebhookPayment).mockRejectedValue(new PaymentError(503, "PAYMENT_BUSY", "Retry."));
    expect((await call()).status).toBe(503);
  });
  it("never acknowledges an unknown processing failure as success", async () => {
    vi.mocked(finalizeWebhookPayment).mockRejectedValue(new Error("private provider data"));
    const response=await call(); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private");
  });
});
