import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { finalizeWebhookPayment } from "@/lib/payments/finalize-backend";
import { PaymentError } from "@/lib/payments/service";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/payments/finalize-backend", () => ({ finalizeWebhookPayment: vi.fn() }));
const secret = "whsec_fixture";
const event = { id: "evt_test", type: "payment_intent.amount_capturable_updated", livemode: false,
  data: { object: { id: "pi_test", object: "payment_intent", livemode: false, metadata: { customerId: "forged" } } } };
const call = (value = event, valid = true) => {
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
  it("rejects invalid signatures before database processing", async () => {
    expect((await call(event, false)).status).toBe(400); expect(finalizeWebhookPayment).not.toHaveBeenCalled();
  });
  it("acknowledges unrelated signed events", async () => {
    expect((await call({ ...event, type: "customer.created" })).status).toBe(200);
    expect(finalizeWebhookPayment).not.toHaveBeenCalled();
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
