import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { CartError, getCustomerCart, setCustomerCartItem, withCartTotals, type CartRow } from "./service";

// One product line at a chosen total weight, to hit the fee and limit boundaries.
function cartAt(totalWeight: number, priceCents = 250): CartRow {
  return {
    cart_id: "cart",
    total_weight: totalWeight,
    items: [{
      product_id: "p1", sku: "SKU", name: "Rice", description: "",
      price_cents: priceCents, unit_weight: totalWeight, quantity: 1, line_weight: totalWeight,
    }],
  };
}

describe("withCartTotals", () => {
  it("returns zero totals for an empty cart", () => {
    expect(withCartTotals({ cart_id: "cart", total_weight: 0, items: [] })).toMatchObject({
      subtotal_cents: 0, total_weight: 0, delivery_fee_cents: 0, total_cents: 0,
      fee_warning: false, over_weight_limit: false,
    });
  });

  it("multiplies server prices and weights by quantity", () => {
    const cart: CartRow = {
      cart_id: "cart", total_weight: 0, items: [
        { product_id: "a", sku: "A", name: "Milk", description: "", price_cents: 499, unit_weight: 860, quantity: 2, line_weight: 1720 },
        { product_id: "b", sku: "B", name: "Eggs", description: "", price_cents: 549, unit_weight: 150, quantity: 1, line_weight: 150 },
      ],
    };
    expect(withCartTotals(cart)).toMatchObject({
      subtotal_cents: 1547, total_weight: 1870, delivery_fee_cents: 0, total_cents: 1547, fee_warning: true,
    });
  });

  it.each([
    [1799, 0, false, false],
    [1800, 0, true, false],
    [1999, 0, true, false],
    [2000, 1000, false, false],
    [19999, 1000, false, false],
    [20000, 1000, false, false],
    [20001, 1000, false, true],
  ])("at weight %i charges fee %i (warning %s, over limit %s)", (weight, fee, warning, over) => {
    expect(withCartTotals(cartAt(weight))).toMatchObject({
      total_weight: weight, delivery_fee_cents: fee, total_cents: 250 + fee,
      fee_warning: warning, over_weight_limit: over,
    });
  });
});

// A client whose only RPC call resolves to the given result.
function fakeDb(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

describe("getCustomerCart", () => {
  it("reads the cart through the given client and adds totals", async () => {
    const { db, rpc } = fakeDb({ data: cartAt(1900), error: null });
    await expect(getCustomerCart(db, "customer")).resolves.toMatchObject({ subtotal_cents: 250, fee_warning: true });
    expect(rpc).toHaveBeenCalledWith("customer_get_cart", { p_customer_id: "customer" });
  });

  it("throws a plain (unexpected) error on an RPC failure", async () => {
    const { db } = fakeDb({ data: null, error: { code: "XX000", message: "boom" } });
    const error = await getCustomerCart(db, "customer").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(CartError);
  });
});

describe("setCustomerCartItem", () => {
  it("passes the change to the RPC and adds totals", async () => {
    const { db, rpc } = fakeDb({ data: cartAt(2000), error: null });
    await expect(setCustomerCartItem(db, "customer", "p1", 1)).resolves.toMatchObject({ delivery_fee_cents: 1000 });
    expect(rpc).toHaveBeenCalledWith("customer_set_cart_item", {
      p_customer_id: "customer", p_product_id: "p1", p_quantity: 1,
    });
  });

  it.each([
    ["P0002", "PRODUCT_UNAVAILABLE"],
    ["P0003", "INSUFFICIENT_STOCK"],
    ["P0004", "CART_OVERWEIGHT"],
  ])("maps RPC error %s to CartError %s", async (rpcCode, code) => {
    const { db } = fakeDb({ data: null, error: { code: rpcCode, message: "db text" } });
    await expect(setCustomerCartItem(db, "customer", "p1", 1)).rejects.toMatchObject({ name: "CartError", code });
  });

  it("throws a plain (unexpected) error for other RPC failures", async () => {
    const { db } = fakeDb({ data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } });
    const error = await setCustomerCartItem(db, "customer", "p1", 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(CartError);
  });
});
