import { createAdminClient } from '@/lib/supabase/admin';
import type { SupabaseClient } from "@supabase/supabase-js";
import { priceCart } from './pricing';

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

export async function getCustomerCart(customerId: string): Promise<CartResponse> {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('customer_get_cart', {
        p_customer_id: customerId,
    });

    if (error) throw error;
    return withCartTotals(data as CartRow);
}

export async function setCustomerCartItem(
    customerId: string,
    productId: string,
    quantity: number
): Promise<CartResponse> {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('customer_set_cart_item', {
        p_customer_id: customerId,
        p_product_id: productId,
        p_quantity: quantity,
    });

    if (error) {
        if (error.code === 'P0003') {
            throw new Error('Requested quantity exceeds available stock.');
        }
        if (error.code === 'P0004') {
            throw new Error('Cart weight exceeds the maximum allowed limit of 200 lb.');
        }
        throw error;
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
