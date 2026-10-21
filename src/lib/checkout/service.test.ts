import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewCustomerCheckout } from "./service";
import { getActiveCart } from "@/lib/cart/service";
import { getCheckoutProducts } from "@/lib/catalog/checkout";
import { getOwnedAddress } from "@/lib/auth/addresses";
import { ServiceAreaUnavailable } from "@/lib/auth/serviceArea";

// Real Supabase query builder and all checkout helpers; only HTTP is replaced.
// Captured requests verify ownership filters and read-only query construction.
// These do not prove SQL permissions or PostGIS behavior; preview.db.test.ts does.
function fixture() {
  const requests: { url: URL; method: string; body: unknown }[] = [];
  const cart = { customer_id: "customer", status: "ACTIVE", cart_items: [{ product_id: "product", quantity: 2 }] };
  const products = [{ id: "product", is_active: true, price_cents: 250, unit_weight: 1000, stock_quantity: 2,
    category: { is_active: true } }];
  const addresses = [{ id: "address", customer_id: "customer", latitude: 0, longitude: 0 }];
  const replies: Record<string, unknown> = { carts: cart, products, customer_read_address_location: addresses };
  let fail = "";
  const db = createClient("http://localhost:54321", "test-only-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const name = url.pathname.split("/").at(-1)!;
      requests.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      if (name === fail) return Response.json({ message: "read failure" }, { status: 500 });
      return Response.json(replies[name]);
    } },
  });
  const expected = { subtotalCents: 500, totalWeight: 2000, deliveryFeeCents: 1000, taxCents: 25, totalCents: 1525 };
  const run = () => previewCustomerCheckout(db, "customer", { addressId: "address", expected });
  return { db, requests, cart, products, addresses, replies, expected, run, fail: (name: string) => { fail = name; } };
}

beforeEach(() => {
  vi.stubEnv("OFS_STORE_LATITUDE", "0");
  vi.stubEnv("OFS_STORE_LONGITUDE", "0");
  vi.stubEnv("OFS_DELIVERY_RADIUS_METERS", "1000");
});
afterEach(() => vi.unstubAllEnvs());

describe("checkout database service adapters", () => {
  it("maps authoritative data, excludes delivery from tax, scopes reads and makes no writes", async () => {
    const f = fixture();
    expect(await f.run()).toEqual({ ok: true, value: { ...f.expected, feeWarning: false } });
    const cartRequest = f.requests.find((r) => r.url.pathname.endsWith("/carts"))!;
    expect(cartRequest.url.searchParams.get("customer_id")).toBe("eq.customer");
    expect(cartRequest.url.searchParams.get("status")).toBe("eq.ACTIVE");
    expect(f.requests.find((r) => r.url.pathname.includes("/rpc/"))?.body)
      .toEqual({ p_customer_id: "customer", p_address_id: "address" });
    const productRequest = f.requests.find((r) => r.url.pathname.endsWith("/products"))!;
    expect(productRequest.url.searchParams.get("id")).toBe("in.(product)");
    expect(productRequest.url.searchParams.has("stock_quantity")).toBe(false);
    expect(f.requests.every((r) => r.method === "GET" || r.url.pathname.endsWith("/rpc/customer_read_address_location"))).toBe(true);
  });
  it("does not create a missing cart or continue reading", async () => {
    const f = fixture(); f.replies.carts = null;
    expect(await f.run()).toMatchObject({ ok: false, error: { code: "CART_UNAVAILABLE" } });
    expect(f.requests).toHaveLength(1);
  });
  it.each(["inactive product", "inactive category", "missing category", "missing product"])("rejects %s", async (kind) => {
    const f = fixture();
    if (kind === "inactive product") f.products[0].is_active = false;
    if (kind === "inactive category") f.products[0].category.is_active = false;
    if (kind === "missing category") f.replies.products = [{ ...f.products[0], category: null }];
    if (kind === "missing product") f.replies.products = [];
    expect(await f.run()).toMatchObject({ ok: false, error: { code: "PRODUCT_UNAVAILABLE" } });
  });
  it("reports insufficient stock instead of hiding a zero-stock product", async () => {
    const f = fixture(); f.products[0].stock_quantity = 0;
    expect(await f.run()).toMatchObject({ ok: false, error: { code: "INSUFFICIENT_STOCK" } });
  });
  it("rejects stale prices and returns recalculated demo tax", async () => {
    const f = fixture(); f.products[0].price_cents = 300;
    expect(await f.run()).toMatchObject({ ok: false, error: { code: "TOTALS_MISMATCH" },
      current: { subtotalCents: 600, taxCents: 30, totalCents: 1630 } });
  });
  it.each(["foreign", "missing", "outside", "no coordinates"])("rejects %s address", async (kind) => {
    const f = fixture();
    if (kind === "foreign") f.addresses[0].customer_id = "other";
    if (kind === "missing") f.replies.customer_read_address_location = [];
    if (kind === "outside") f.addresses[0].latitude = 1;
    if (kind === "no coordinates") f.replies.customer_read_address_location = [{ ...f.addresses[0], latitude: null }];
    expect(await f.run()).toMatchObject({ ok: false, error: { code: "ADDRESS_INVALID" } });
  });
  it("never approves an address with missing configuration", async () => {
    vi.stubEnv("OFS_DELIVERY_RADIUS_METERS", "");
    await expect(fixture().run()).rejects.toThrow(ServiceAreaUnavailable);
  });
  it.each(["carts", "products", "customer_read_address_location"])("propagates %s failures", async (name) => {
    const f = fixture(); f.fail(name);
    await expect(f.run()).rejects.toThrow("read failure");
  });
  it("handles empty product requests without querying", async () => {
    const f = fixture();
    expect(await getCheckoutProducts(f.db, [])).toEqual([]);
    expect(f.requests).toEqual([]);
  });
  it("returns neutral null for unknown owned addresses and carts", async () => {
    const f = fixture(); f.replies.carts = null; f.replies.customer_read_address_location = [];
    expect(await getActiveCart(f.db, "customer")).toBeNull();
    expect(await getOwnedAddress(f.db, "customer", "missing")).toBeNull();
  });
});
