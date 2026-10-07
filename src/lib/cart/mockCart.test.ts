import { describe, expect, it } from "vitest";
import { formatCents, formatWeight } from "./format";
import { SAMPLE_CART, setQuantity, type CartItem } from "./mockCart";
import { priceCart } from "./pricing";

describe("formatCents", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [1299, "$12.99"],
    [123456, "$1,234.56"],
    [-1000, "-$10.00"],
  ])("%i -> %s", (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });
});

describe("formatWeight", () => {
  it.each([
    [0, "0.00 lb"],
    [1999, "19.99 lb"],
    [2000, "20.00 lb"],
    [20000, "200.00 lb"],
  ])("%i -> %s", (weight, text) => {
    expect(formatWeight(weight)).toBe(text);
  });
});

describe("SAMPLE_CART", () => {
  it("starts inside the fee-warning band", () => {
    const pricing = priceCart(SAMPLE_CART);
    expect(pricing.totalWeight).toBe(1860);
    expect(pricing.feeWarning).toBe(true);
    expect(pricing.deliveryFeeCents).toBe(0);
  });
});

describe("setQuantity", () => {
  const item = (productId: string, unitWeight: number, quantity: number): CartItem => ({
    productId,
    name: productId,
    unitLabel: "each",
    unitPriceCents: 100,
    unitWeight,
    quantity,
  });

  it("updates the quantity of an existing line", () => {
    const result = setQuantity([item("milk", 860, 1)], "milk", 3);
    expect(result).toEqual({ ok: true, items: [item("milk", 860, 3)] });
  });

  it("removes the line when quantity is 0", () => {
    const result = setQuantity([item("milk", 860, 1), item("eggs", 150, 2)], "milk", 0);
    expect(result).toEqual({ ok: true, items: [item("eggs", 150, 2)] });
  });

  it("adds a sample product that is not in the cart yet", () => {
    const result = setQuantity([], "water", 2);
    expect(result.ok && result.items).toMatchObject([{ productId: "water", unitWeight: 3500, quantity: 2 }]);
  });

  it("rejects unknown products", () => {
    expect(setQuantity([], "caviar", 1).ok).toBe(false);
  });

  it.each([-1, 1.5, Number.NaN])("rejects quantity %s", (quantity) => {
    expect(setQuantity([item("milk", 860, 1)], "milk", quantity).ok).toBe(false);
  });

  it("allows a cart of exactly 200.00 lb", () => {
    const result = setQuantity([item("a", 10000, 1)], "a", 2);
    expect(result.ok).toBe(true);
  });

  it("allows 199.99 lb", () => {
    const result = setQuantity([item("a", 19999, 0)], "a", 1);
    expect(result.ok).toBe(true);
  });

  it("rejects a change that would exceed 200.00 lb and keeps the cart unchanged", () => {
    const cart = [item("a", 10000, 2), item("b", 1, 0)];
    const before = structuredClone(cart);
    const result = setQuantity(cart, "b", 1);
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("200.01 lb"),
    });
    expect(cart).toEqual(before);
  });
});

describe("demo walkthrough from SAMPLE_CART", () => {
  function apply(items: CartItem[], productId: string, quantity: number): CartItem[] {
    const result = setQuantity(items, productId, quantity);
    if (!result.ok) throw new Error(result.error);
    return result.items;
  }

  it("goes from warning, to fee, to a rejected over-limit change", () => {
    let cart = [...SAMPLE_CART];

    cart = apply(cart, "milk", 2); // 27.20 lb
    expect(priceCart(cart)).toMatchObject({ totalWeight: 2720, deliveryFeeCents: 1000, feeWarning: false });

    cart = apply(cart, "water", 4); // 167.20 lb
    expect(priceCart(cart).totalWeight).toBe(16720);

    const fifth = setQuantity(cart, "water", 5); // would be 202.20 lb
    expect(fifth).toEqual({ ok: false, error: expect.stringContaining("202.20 lb") });

    cart = apply(cart, "milk", 1); // back to one gallon
    cart = apply(cart, "water", 0);
    expect(priceCart(cart)).toMatchObject({ totalWeight: 1860, deliveryFeeCents: 0, feeWarning: true });
  });
});
