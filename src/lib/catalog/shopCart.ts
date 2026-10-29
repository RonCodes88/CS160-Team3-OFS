// A line in the storefront's mini-cart, mapped from GET/POST /api/cart. The
// server prices the cart; these lines only drive item counts and steppers.

export type ShopCartLine = {
  productId: string;
  name: string;
  unitPriceCents: number;
  /** Hundredths of a pound. */
  unitWeight: number;
  quantity: number;
};
