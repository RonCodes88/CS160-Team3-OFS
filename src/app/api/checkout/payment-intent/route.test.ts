import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { getSessionUser } from "@/lib/auth/session";
import { createCustomerPaymentIntent } from "@/lib/payments/backend";
import { PaymentError } from "@/lib/payments/service";
import { ServiceAreaUnavailable } from "@/lib/auth/serviceArea";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/payments/backend", () => ({ createCustomerPaymentIntent: vi.fn() }));
const body = { addressId: "ABCDEFAB-0000-4000-8000-000000000001",
  expected: { subtotalCents: 500, totalWeight: 100, deliveryFeeCents: 0, taxCents: 25, totalCents: 525 } };
const call = (payload: unknown = body, key = "request-1", contentType = "application/json") => POST(new NextRequest("http://localhost/api/checkout/payment-intent", {
  method: "POST", headers: { "content-type": contentType, "Idempotency-Key": key },
  body: typeof payload === "string" ? payload : JSON.stringify(payload),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "customer", email: "test@example.test", role: "CUSTOMER" });
  vi.mocked(createCustomerPaymentIntent).mockResolvedValue({ attemptId: "attempt", paymentIntentId: "pi_test", clientSecret: "secret", status: "requires_payment_method" });
});

describe("POST checkout payment-intent", () => {
  it("uses session identity and sanitized input, with no caching", async () => {
    const response = await call({ ...body, customerId: "victim", totalCents: 1 });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(createCustomerPaymentIntent).toHaveBeenCalledWith({}, "customer", "request-1", { ...body, addressId: body.addressId.toLowerCase() });
    expect(await response.json()).toMatchObject({ paymentIntentId: "pi_test" });
  });
  it("returns 401 without a session", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(createCustomerPaymentIntent).not.toHaveBeenCalled();
  });
  it.each(["EMPLOYEE", "MANAGER", "VEHICLE"] as const)("rejects %s", async (role) => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: "staff", email: "staff@example.test", role });
    expect((await call()).status).toBe(403);
    expect(createCustomerPaymentIntent).not.toHaveBeenCalled();
  });
  it.each(["", "bad key", "x".repeat(129)])("rejects invalid key %s", async (key) => {
    expect((await call(body, key)).status).toBe(400);
    expect(createCustomerPaymentIntent).not.toHaveBeenCalled();
  });
  it.each([{}, null, { ...body, addressId: "bad" }, { ...body, expected: {} }])("rejects malformed request %j", async (payload) => {
    expect((await call(payload)).status).toBe(400);
    expect(createCustomerPaymentIntent).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON and non-JSON content", async () => {
    expect((await call("{")).status).toBe(400);
    expect((await call(body, "key", "text/plain")).status).toBe(415);
  });
  it("returns specific conflicts and revised totals", async () => {
    vi.mocked(createCustomerPaymentIntent).mockRejectedValue(new PaymentError(409, "TOTALS_MISMATCH", "Review totals.", body.expected));
    const response = await call();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "TOTALS_MISMATCH" }, current: body.expected, taxPolicy: { excludesDelivery: true } });
  });
  it("returns 503 when delivery configuration is unavailable", async () => {
    vi.mocked(createCustomerPaymentIntent).mockRejectedValue(new ServiceAreaUnavailable());
    expect((await call()).status).toBe(503);
  });
  it("does not expose or log unexpected provider objects", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(createCustomerPaymentIntent).mockRejectedValue(new Error("secret provider details"));
      const response = await call();
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("secret");
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
