import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { getSessionUser } from "@/lib/auth/session";

// Real route and cart service; only the session lookup and the RPC client are faked.
const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ rpc })) }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn() }));

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const cartRow = {
  cart_id: "cart",
  total_weight: 1900,
  items: [{
    product_id: PRODUCT_ID, sku: "MILK", name: "Whole Milk", description: "",
    price_cents: 499, unit_weight: 950, quantity: 2, line_weight: 1900,
  }],
};
const url = "http://localhost/api/cart";
const post = (payload: unknown) => POST(new NextRequest(url, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
}));

// A Postgres error whose text must never reach the browser.
const dbError = { code: "XX000", message: "relation \"public.carts\" does not exist" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getSessionUser).mockResolvedValue({ id: "customer", email: "c@test.local", role: "CUSTOMER" });
  rpc.mockResolvedValue({ data: cartRow, error: null });
});

describe("GET /api/cart", () => {
  it("returns the session customer's cart with server-priced totals", async () => {
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: cartRow.items, subtotal_cents: 998, total_weight: 1900,
      delivery_fee_cents: 0, total_cents: 998, fee_warning: true, over_weight_limit: false,
    });
    expect(rpc).toHaveBeenCalledWith("customer_get_cart", { p_customer_id: "customer" });
  });

  it("returns 401 without a session and never reads a cart", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    expect((await GET(new NextRequest(url))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns 403 for staff roles", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: "staff", email: "s@test.local", role: "EMPLOYEE" });
    expect((await GET(new NextRequest(url))).status).toBe(403);
  });

  it("returns a generic 500 for an unexpected database error without leaking its text", async () => {
    rpc.mockResolvedValue({ data: null, error: dbError });
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } });
    expect(text).not.toContain("relation");
    expect(console.error).toHaveBeenCalled();
  });
});

describe("POST /api/cart", () => {
  it("returns updated totals, charging the fee at 20.00 lb", async () => {
    rpc.mockResolvedValue({
      data: { ...cartRow, total_weight: 2000, items: [{ ...cartRow.items[0], unit_weight: 1000, line_weight: 2000 }] },
      error: null,
    });
    const response = await post({ productId: PRODUCT_ID, quantity: 2 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ delivery_fee_cents: 1000, total_cents: 1998, fee_warning: false });
    expect(rpc).toHaveBeenCalledWith("customer_set_cart_item", { p_customer_id: "customer", p_product_id: PRODUCT_ID, p_quantity: 2 });
  });

  it("rejects a change over 200 lb with 422 and the message the UI shows", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0004", message: "cart weight exceeds 200.00 lb" } });
    const response = await post({ productId: PRODUCT_ID, quantity: 99 });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: { code: "CART_OVERWEIGHT", message: "Cart weight exceeds the maximum allowed limit of 200 lb." },
    });
  });

  it("rejects more than the available stock with 409", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0003", message: "requested quantity exceeds available stock" } });
    const response = await post({ productId: PRODUCT_ID, quantity: 50 });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "INSUFFICIENT_STOCK", message: "Requested quantity exceeds available stock." },
    });
  });

  it("rejects a retired or unknown product with 409", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "product is not available" } });
    const response = await post({ productId: PRODUCT_ID, quantity: 1 });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("PRODUCT_UNAVAILABLE");
  });

  it("returns a generic 500, not 400, for an unexpected database error", async () => {
    rpc.mockResolvedValue({ data: null, error: dbError });
    const response = await post({ productId: PRODUCT_ID, quantity: 1 });
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } });
    expect(text).not.toContain("relation");
  });

  it("returns 500 when the database call itself throws", async () => {
    rpc.mockRejectedValue(new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:54321"));
    const response = await post({ productId: PRODUCT_ID, quantity: 1 });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("ECONNREFUSED");
  });

  it("rejects fractional or negative quantities before touching the cart", async () => {
    expect((await post({ productId: PRODUCT_ID, quantity: 1.5 })).status).toBe(400);
    expect((await post({ productId: PRODUCT_ID, quantity: -1 })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing body", null],
    ["a non-UUID product ID", { productId: "p1", quantity: 1 }],
    ["a string quantity", { productId: PRODUCT_ID, quantity: "2" }],
    ["a quantity too large for the database", { productId: PRODUCT_ID, quantity: 3_000_000_000 }],
  ])("rejects %s with 400 before touching the cart", async (_label, payload) => {
    const response = await post(payload);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    const response = await POST(new NextRequest(url, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{",
    }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
