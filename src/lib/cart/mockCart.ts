// Stand-in for the cart API (#14, #15) until the database exists. It applies
// the same rules the server will: prices come from product data, never the
// client, and a change that would push the cart over MAX_CART_WEIGHT is
// rejected rather than split. Replace with API calls once they land.

import { MAX_CART_WEIGHT, priceCart } from "./pricing";
import { formatWeight } from "./format";

export type CartItem = {
  productId: string;
  name: string;
  unitLabel: string;
  unitPriceCents: number;
  /** Hundredths of a pound. */
  unitWeight: number;
  quantity: number;
};

export type CartChange = { ok: true; items: CartItem[] } | { ok: false; error: string };

/** Products the demo cart can hold. */
export const SAMPLE_PRODUCTS: readonly Omit<CartItem, "quantity">[] = [
  { productId: "bananas", name: "Organic Bananas", unitLabel: "bunch", unitPriceCents: 249, unitWeight: 200 },
  { productId: "milk", name: "Whole Milk", unitLabel: "1 gal", unitPriceCents: 499, unitWeight: 860 },
  { productId: "eggs", name: "Large Eggs", unitLabel: "dozen", unitPriceCents: 549, unitWeight: 150 },
  { productId: "bread", name: "Sourdough Bread", unitLabel: "loaf", unitPriceCents: 699, unitWeight: 150 },
  { productId: "rice", name: "Jasmine Rice", unitLabel: "5 lb bag", unitPriceCents: 1199, unitWeight: 500 },
  { productId: "water", name: "Spring Water", unitLabel: "24-pack", unitPriceCents: 799, unitWeight: 3500 },
];

/** One of everything but the water: 18.60 lb, so the fee warning shows right away. */
export const SAMPLE_CART: readonly CartItem[] = SAMPLE_PRODUCTS.filter((p) => p.productId !== "water").map(
  (p) => ({ ...p, quantity: 1 }),
);

/**
 * Sets a product's quantity. 0 removes the line; a product not yet in the cart
 * is added from SAMPLE_PRODUCTS. Rejects the change if the cart would exceed
 * MAX_CART_WEIGHT, leaving the cart as it was.
 */
export function setQuantity(items: readonly CartItem[], productId: string, quantity: number): CartChange {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    return { ok: false, error: "Quantity must be a whole number of 0 or more." };
  }

  const existing = items.find((item) => item.productId === productId);
  let next: CartItem[];
  if (existing) {
    next = items
      .map((item) => (item.productId === productId ? { ...item, quantity } : item))
      .filter((item) => item.quantity > 0);
  } else {
    const product = SAMPLE_PRODUCTS.find((p) => p.productId === productId);
    if (!product) return { ok: false, error: "That product is not available." };
    next = quantity > 0 ? [...items, { ...product, quantity }] : [...items];
  }

  const { totalWeight } = priceCart(next);
  if (totalWeight > MAX_CART_WEIGHT) {
    return {
      ok: false,
      error: `That would bring your cart to ${formatWeight(totalWeight)}. Orders can weigh at most ${formatWeight(MAX_CART_WEIGHT)}, so the change wasn't made.`,
    };
  }
  return { ok: true, items: next };
}
