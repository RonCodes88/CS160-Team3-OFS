// What the shopper has added from the storefront in this visit. Stand-in for
// POST /api/cart/items (#15): it applies the same weight rule the server
// will, rejecting an add that would push the cart over MAX_CART_WEIGHT rather
// than splitting the order. Replace with the cart API once it lands.

import { formatWeight } from "@/lib/cart/format";
import { MAX_CART_WEIGHT, priceCart } from "@/lib/cart/pricing";
import type { CatalogProduct } from "./types";

export type ShopCartLine = {
  productId: string;
  name: string;
  unitPriceCents: number;
  /** Hundredths of a pound. */
  unitWeight: number;
  quantity: number;
};

export type AddResult = { ok: true; lines: ShopCartLine[] } | { ok: false; error: string };

type Addable = Pick<CatalogProduct, "id" | "name" | "priceCents" | "unitWeight" | "inStock">;

/** Adds one of `product`, or explains why it can't be added. */
export function addToShopCart(lines: readonly ShopCartLine[], product: Addable): AddResult {
  if (!product.inStock) {
    return { ok: false, error: `${product.name} is out of stock.` };
  }

  const existing = lines.find((line) => line.productId === product.id);
  const next = existing
    ? lines.map((line) => (line === existing ? { ...line, quantity: line.quantity + 1 } : line))
    : [
        ...lines,
        {
          productId: product.id,
          name: product.name,
          unitPriceCents: product.priceCents,
          unitWeight: product.unitWeight,
          quantity: 1,
        },
      ];

  const { totalWeight } = priceCart(next);
  if (totalWeight > MAX_CART_WEIGHT) {
    return {
      ok: false,
      error: `Adding ${product.name} would bring your cart to ${formatWeight(totalWeight)}. Orders can weigh at most ${formatWeight(MAX_CART_WEIGHT)}, so it wasn't added.`,
    };
  }
  return { ok: true, lines: next };
}

/** How many of a product are in the cart. */
export function quantityOf(lines: readonly ShopCartLine[], productId: string): number {
  return lines.find((line) => line.productId === productId)?.quantity ?? 0;
}
