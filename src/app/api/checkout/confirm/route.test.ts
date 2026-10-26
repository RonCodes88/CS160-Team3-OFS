import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { getSessionUser } from "@/lib/auth/session";
import { confirmCustomerPayment } from "@/lib/payments/finalize-backend";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/payments/finalize-backend", () => ({ confirmCustomerPayment: vi.fn() }));
const id = "00000000-0000-4000-8000-000000000001";
const call = (body: unknown = { attemptId: id }, key = "original-key", contentType = "application/json") => POST(new NextRequest("http://localhost/api/checkout/confirm", {
  method: "POST", headers: { "content-type": contentType, "Idempotency-Key": key }, body: JSON.stringify(body),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "customer", email: "test@example.test", role: "CUSTOMER" });
  vi.mocked(confirmCustomerPayment).mockResolvedValue({ attemptId: id, status: "CAPTURED", orderId: "order" });
});
describe("customer payment confirmation", () => {
  it("uses the verified session and original key, with no caching", async () => {
    const response = await call({ attemptId: id, customerId: "other", amount: 1 }); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(confirmCustomerPayment).toHaveBeenCalledWith({}, "customer", id, "original-key");
  });
  it("requires authentication", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null); expect((await call()).status).toBe(401);
    expect(confirmCustomerPayment).not.toHaveBeenCalled();
  });
  it.each(["EMPLOYEE","MANAGER","VEHICLE"] as const)("rejects %s", async (role) => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: "staff", email: "staff@example.test", role });
    expect((await call()).status).toBe(403); expect(confirmCustomerPayment).not.toHaveBeenCalled();
  });
  it.each([{},null,{ attemptId: "bad" }])("rejects invalid input %j", async (body) => {
    expect((await call(body)).status).toBe(400); expect(confirmCustomerPayment).not.toHaveBeenCalled();
  });
  it("requires an idempotency key and JSON", async () => {
    expect((await call({ attemptId:id },"")).status).toBe(400);
    expect((await call({ attemptId:id },"key","text/plain")).status).toBe(415);
  });
  it("returns an error for a declined payment", async () => {
    vi.mocked(confirmCustomerPayment).mockResolvedValue({ attemptId:id,status:"PENDING",failureCode:"PAYMENT_DECLINED" });
    const response=await call(); expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code:"PAYMENT_DECLINED" } });
  });
  it("returns 202 while customer authentication or provider processing remains pending", async () => {
    vi.mocked(confirmCustomerPayment).mockResolvedValue({ attemptId:id,status:"PENDING",providerStatus:"requires_action" });
    expect((await call()).status).toBe(202);
  });
  it("returns a retryable response without leaking unexpected errors", async () => {
    vi.mocked(confirmCustomerPayment).mockRejectedValue(new Error("private"));
    const response=await call(); expect(response.status).toBe(503); expect(await response.text()).not.toContain("private");
  });
});
