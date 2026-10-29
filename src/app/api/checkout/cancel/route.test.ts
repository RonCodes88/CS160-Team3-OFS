import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { getSessionUser } from "@/lib/auth/session";
import { cancelCustomerPayments } from "@/lib/payments/finalize-backend";
import { PaymentError } from "@/lib/payments/service";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/payments/finalize-backend", () => ({ cancelCustomerPayments: vi.fn() }));

const call = (contentType = "application/json") => POST(new NextRequest("http://localhost/api/checkout/cancel", {
  method: "POST", headers: { "content-type": contentType }, body: JSON.stringify({ customerId: "other" }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "customer", email: "c@example.test", role: "CUSTOMER" });
  vi.mocked(cancelCustomerPayments).mockResolvedValue({ canceled: 1 });
});

describe("POST /api/checkout/cancel", () => {
  it("cancels only the session customer's payments, with no caching", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ canceled: 1 });
    expect(cancelCustomerPayments).toHaveBeenCalledWith({}, "customer");
  });

  it("requires a customer session and JSON", async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce(null);
    expect((await call()).status).toBe(401);
    vi.mocked(getSessionUser).mockResolvedValueOnce({ id: "v", email: "v@example.test", role: "VEHICLE" });
    expect((await call()).status).toBe(403);
    expect((await call("text/plain")).status).toBe(415);
    expect(cancelCustomerPayments).not.toHaveBeenCalled();
  });

  it("passes payment errors through and hides unexpected ones", async () => {
    vi.mocked(cancelCustomerPayments).mockRejectedValueOnce(new PaymentError(409, "PAYMENT_ALREADY_AUTHORIZED", "Finish it."));
    const conflict = await call();
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: "PAYMENT_ALREADY_AUTHORIZED" } });
    vi.mocked(cancelCustomerPayments).mockRejectedValueOnce(new Error("private"));
    const failure = await call();
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain("private");
  });
});
