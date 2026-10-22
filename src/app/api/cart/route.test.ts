import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { getSessionUser } from "@/lib/auth/session";

// Real route and cart service; only the session lookup and the RPC client are faked.
const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ rpc })) }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn() }));

const cartRow = {
  cart_id: "cart",
  total_weight: 1900,
  items: [{
    product_id: "p1", sku: "MILK", name: "Whole Milk", description: "",
    price_cents: 499, unit_weight: 950, quantity: 2, line_weight: 1900,
  }],
};
const url = "http://localhost/api/cart";
const post = (payload: unknown) => POST(new NextRequest(url, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
}));

beforeEach(() => {
  vi.clearAllMocks();
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
});

describe("POST /api/cart", () => {
  it("returns updated totals, charging the fee at 20.00 lb", async () => {
    rpc.mockResolvedValue({
      data: { ...cartRow, total_weight: 2000, items: [{ ...cartRow.items[0], unit_weight: 1000, line_weight: 2000 }] },
      error: null,
    });
    const response = await post({ productId: "p1", quantity: 2 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ delivery_fee_cents: 1000, total_cents: 1998, fee_warning: false });
    expect(rpc).toHaveBeenCalledWith("customer_set_cart_item", { p_customer_id: "customer", p_product_id: "p1", p_quantity: 2 });
  });

  it("rejects a change over 200 lb with a clear message", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0004", message: "cart weight exceeded" } });
    const response = await post({ productId: "p1", quantity: 99 });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { message: "Cart weight exceeds the maximum allowed limit of 200 lb." } });
  });

  it("rejects fractional or negative quantities before touching the cart", async () => {
    expect((await post({ productId: "p1", quantity: 1.5 })).status).toBe(400);
    expect((await post({ productId: "p1", quantity: -1 })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
