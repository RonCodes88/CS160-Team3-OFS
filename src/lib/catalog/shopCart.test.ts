import { describe, expect, it } from "vitest";
import { priceCart } from "@/lib/cart/pricing";
import { addToShopCart, quantityOf, type ShopCartLine } from "./shopCart";

function product(id: string, unitWeight: number, inStock = true) {
  return { id, name: `Product ${id}`, priceCents: 100, unitWeight, inStock };
}

/** A cart holding one line that weighs `weight`. */
function cartWeighing(weight: number): ShopCartLine[] {
  return [{ productId: "base", name: "Base", unitPriceCents: 100, unitWeight: weight, quantity: 1 }];
}

function addOrThrow(lines: readonly ShopCartLine[], p: ReturnType<typeof product>) {
  const result = addToShopCart(lines, p);
  if (!result.ok) throw new Error(result.error);
  return result.lines;
}

describe("addToShopCart", () => {
  it("adds a new product with quantity 1, using catalog price and weight", () => {
    const lines = addOrThrow([], { id: "milk", name: "Whole Milk", priceCents: 499, unitWeight: 860, inStock: true });
    expect(lines).toEqual([{ productId: "milk", name: "Whole Milk", unitPriceCents: 499, unitWeight: 860, quantity: 1 }]);
  });

  it("increments a product already in the cart", () => {
    const p = product("a", 100);
    const lines = addOrThrow(addOrThrow([], p), p);
    expect(quantityOf(lines, "a")).toBe(2);
    expect(lines).toHaveLength(1);
  });

  it("does not mutate the input", () => {
    const lines = cartWeighing(100);
    addOrThrow(lines, product("base", 100));
    expect(lines[0].quantity).toBe(1);
  });

  it("rejects out-of-stock products", () => {
    const result = addToShopCart([], product("a", 100, false));
    expect(result).toEqual({ ok: false, error: "Product a is out of stock." });
  });

  // Fee boundaries come from priceCart; these check the shop cart feeds it correctly.
  it("reaching 19.99 lb stays free with a warning", () => {
    const pricing = priceCart(addOrThrow(cartWeighing(1899), product("a", 100)));
    expect(pricing.totalWeight).toBe(1999);
    expect(pricing.deliveryFeeCents).toBe(0);
    expect(pricing.feeWarning).toBe(true);
  });

  it("reaching 20.00 lb adds the delivery fee", () => {
    const pricing = priceCart(addOrThrow(cartWeighing(1900), product("a", 100)));
    expect(pricing.totalWeight).toBe(2000);
    expect(pricing.deliveryFeeCents).toBe(1000);
  });

  it("allows reaching 199.99 lb", () => {
    expect(priceCart(addOrThrow(cartWeighing(19899), product("a", 100))).totalWeight).toBe(19999);
  });

  it("allows reaching exactly 200.00 lb", () => {
    expect(priceCart(addOrThrow(cartWeighing(19900), product("a", 100))).totalWeight).toBe(20000);
  });

  it("rejects an add that goes above 200.00 lb and leaves the cart unchanged", () => {
    const lines = cartWeighing(19901);
    const result = addToShopCart(lines, product("a", 100));
    expect(result).toEqual({
      ok: false,
      error: "Adding Product a would bring your cart to 200.01 lb. Orders can weigh at most 200.00 lb, so it wasn't added.",
    });
    expect(lines).toEqual(cartWeighing(19901));
  });

  it("rejects incrementing an existing line past the limit", () => {
    const p = product("a", 10000);
    const lines = addOrThrow(addOrThrow([], p), p);
    expect(priceCart(lines).totalWeight).toBe(20000);
    expect(addToShopCart(lines, p).ok).toBe(false);
  });
});

describe("quantityOf", () => {
  it("is 0 for a product not in the cart", () => {
    expect(quantityOf([], "a")).toBe(0);
  });
});
