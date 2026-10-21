import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { getSessionUser, type Role } from "@/lib/auth/session";
import { previewCustomerCheckout } from "@/lib/checkout/service";
import { ServiceAreaUnavailable } from "@/lib/auth/serviceArea";

// Keep real role checks and input parsing, but replace session lookup and checkout
// service calls. This isolates HTTP behavior without needing database fixtures.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/checkout/service", () => ({ previewCustomerCheckout: vi.fn() }));
const addressId = "00000000-0000-4000-8000-000000000001";
const expected = { subtotalCents: 500, totalWeight: 100, deliveryFeeCents: 0, taxCents: 25, totalCents: 525 };
const value = { ...expected, feeWarning: false };
const body = { addressId, expected };
const call = (payload: unknown = body, contentType = "application/json") => POST(new NextRequest("http://localhost/api/checkout/preview", {
  method: "POST", headers: { "content-type": contentType }, body: typeof payload === "string" ? payload : JSON.stringify(payload),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({ id: "customer", email: "c@test.local", role: "CUSTOMER" });
  vi.mocked(previewCustomerCheckout).mockResolvedValue({ ok: true, value });
});

describe("POST checkout preview", () => {
  it("uses session identity, returns totals and demo-tax metadata without caching", async () => {
    const response = await call({ ...body, customerId: "other", role: "MANAGER" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ ...value, taxPolicy: { label: "Demo tax (5%)", excludesDelivery: true } });
    expect(previewCustomerCheckout).toHaveBeenCalledWith({}, "customer", expect.objectContaining(body));
  });
  it("returns 401 without a valid session and never reads checkout data", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(previewCustomerCheckout).not.toHaveBeenCalled();
  });
  it("normalizes UUID case before comparing returned database IDs", async () => {
    const uppercase = "ABCDEFAB-0000-4000-8000-000000000001";
    expect((await call({ ...body, addressId: uppercase })).status).toBe(200);
    expect(previewCustomerCheckout).toHaveBeenCalledWith({}, "customer", { ...body, addressId: uppercase.toLowerCase() });
  });
  it.each<Role>(["EMPLOYEE", "MANAGER", "VEHICLE"])("rejects %s", async (role) => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: "staff", email: "s@test.local", role });
    expect((await call()).status).toBe(403);
    expect(previewCustomerCheckout).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { ...body, addressId: "bad" }, { addressId }, { ...body, expected: { ...expected, taxCents: -1 } }])(
    "rejects bad input %j before service access", async (payload) => {
      expect((await call(payload)).status).toBe(400);
      expect(previewCustomerCheckout).not.toHaveBeenCalled();
    },
  );
  it("rejects malformed JSON and non-JSON content", async () => {
    expect((await call("{")).status).toBe(400);
    expect((await call(body, "text/plain")).status).toBe(415);
    expect(previewCustomerCheckout).not.toHaveBeenCalled();
  });
  it.each([
    ["PRODUCT_UNAVAILABLE", 409], ["INSUFFICIENT_STOCK", 409], ["TOTALS_MISMATCH", 409],
    ["CART_EMPTY", 422], ["CART_UNAVAILABLE", 422], ["CART_OVERWEIGHT", 422], ["ADDRESS_INVALID", 422],
    ["INVALID_CART", 422], ["INVALID_QUANTITY", 422],
  ] as const)("maps %s to %i", async (code, status) => {
    vi.mocked(previewCustomerCheckout).mockResolvedValue({ ok: false, error: { code, message: "Specific failure" },
      ...(code === "TOTALS_MISMATCH" ? { current: value } : {}) });
    const response = await call();
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code, message: "Specific failure" },
      ...(code === "TOTALS_MISMATCH" ? { current: value } : {}) });
  });
  it("returns 503 when the service area is not configured", async () => {
    vi.mocked(previewCustomerCheckout).mockRejectedValue(new ServiceAreaUnavailable());
    const response = await call();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "SERVICE_AREA_UNAVAILABLE" } });
  });
  it("does not expose database errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(previewCustomerCheckout).mockRejectedValue(new Error("private db details"));
      const response = await call();
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain("private db details");
    } finally { log.mockRestore(); }
  });
});
