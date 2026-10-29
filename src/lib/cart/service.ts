import type { SupabaseClient } from "@supabase/supabase-js";
import { priceCart } from "./pricing";

/** Cart shape returned by the customer_get_cart / customer_set_cart_item RPCs. */
export interface CartRow {
  cart_id: string;
  total_weight: number;
  items: Array<{
    product_id: string;
    sku: string;
    name: string;
    description: string;
    price_cents: number;
    unit_weight: number;
    quantity: number;
    line_weight: number;
  }>;
}

/**
 * Cart plus totals priced on the server from current product rows, so the
 * storefront displays these values instead of doing its own math.
 */
export interface CartResponse extends CartRow {
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  fee_warning: boolean;
  over_weight_limit: boolean;
}

export function withCartTotals(cart: CartRow): CartResponse {
  const pricing = priceCart(cart.items.map((item) => ({
    unitPriceCents: item.price_cents,
    unitWeight: item.unit_weight,
    quantity: item.quantity,
  })));

  return {
    ...cart,
    total_weight: pricing.totalWeight,
    subtotal_cents: pricing.subtotalCents,
    delivery_fee_cents: pricing.deliveryFeeCents,
    total_cents: pricing.totalCents,
    fee_warning: pricing.feeWarning,
    over_weight_limit: pricing.overWeightLimit,
  };
}

export type CartErrorCode = "PRODUCT_UNAVAILABLE" | "INSUFFICIENT_STOCK" | "CART_OVERWEIGHT";

/**
 * An intentional cart rule violation with a message that is safe to show the
 * shopper. Anything else thrown from this module is unexpected.
 */
export class CartError extends Error {
  constructor(readonly code: CartErrorCode, message: string) {
    super(message);
    this.name = "CartError";
  }
}

// Error codes raised by customer_set_cart_item (see the cart migration).
const RPC_ERRORS: Record<string, [CartErrorCode, string]> = {
  P0002: ["PRODUCT_UNAVAILABLE", "This product is no longer available."],
  P0003: ["INSUFFICIENT_STOCK", "Requested quantity exceeds available stock."],
  P0004: ["CART_OVERWEIGHT", "Cart weight exceeds the maximum allowed limit of 200 lb."],
};

export async function getCustomerCart(db: SupabaseClient, customerId: string): Promise<CartResponse> {
  const { data, error } = await db.rpc("customer_get_cart", {
    p_customer_id: customerId,
  });

  if (error) throw new Error(`customer_get_cart failed: ${error.message}`);
  return withCartTotals(data as CartRow);
}

export async function setCustomerCartItem(
  db: SupabaseClient,
  customerId: string,
  productId: string,
  quantity: number,
): Promise<CartResponse> {
  const { data, error } = await db.rpc("customer_set_cart_item", {
    p_customer_id: customerId,
    p_product_id: productId,
    p_quantity: quantity,
  });

  if (error) {
    const known = RPC_ERRORS[error.code];
    if (known) throw new CartError(...known);
    throw new Error(`customer_set_cart_item failed: ${error.message}`);
  }

  return withCartTotals(data as CartRow);
}

export type ActiveCart = {
  customerId: string;
  status: string;
  items: { productId: string; quantity: number }[];
};

/**
 * Read an existing active cart for a verified session customer. The admin client
 * bypasses RLS, so the customer filter is essential for ownership isolation.
 * Unlike customer_get_cart, this does not create a missing cart. Prices and
 * stock are intentionally loaded separately from current product data.
 */
export async function getActiveCart(db: SupabaseClient, customerId: string): Promise<ActiveCart | null> {
  const { data, error } = await db.from("carts")
    .select("customer_id, status, cart_items(product_id, quantity)")
    .eq("customer_id", customerId).eq("status", "ACTIVE").maybeSingle();
  if (error) throw new Error(`getActiveCart failed: ${error.message}`);
  if (!data) return null;
  return {
    customerId: data.customer_id,
    status: data.status,
    items: data.cart_items.map((item: { product_id: string; quantity: number }) => ({
      productId: item.product_id, quantity: item.quantity,
    })),
  };
}
