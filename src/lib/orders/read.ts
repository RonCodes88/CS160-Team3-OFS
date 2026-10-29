import type { SupabaseClient } from "@supabase/supabase-js";

// Read side of the Order service. The Order service owns orders, order_items
// and order_status_history; other services read orders through here instead of
// querying those tables themselves.

/** An order's checkout snapshot: totals, delivery address, and line items. */
export type OrderSummary = {
  id: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
  deliveryAddress: Record<string, unknown>;
  items: { productName: string; quantity: number; unitPriceCents: number }[];
};

type OrderRow = {
  id: string;
  subtotal_cents: number;
  delivery_fee_cents: number;
  tax_cents: number;
  total_cents: number;
  delivery_address: Record<string, unknown> | null;
  order_items: { product_name: string; quantity: number; unit_price_cents: number }[];
};

/** Loads an order's checkout snapshot, or null when the order does not exist. */
export async function getOrderSummary(db: SupabaseClient, orderId: string): Promise<OrderSummary | null> {
  const { data, error } = await db
    .from("orders")
    .select(
      "id, subtotal_cents, delivery_fee_cents, tax_cents, total_cents, delivery_address, order_items(product_name, quantity, unit_price_cents)",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(`loading order ${orderId} failed: ${error.message}`);
  if (!data) return null;
  const row = data as OrderRow;
  return {
    id: row.id,
    subtotalCents: row.subtotal_cents,
    deliveryFeeCents: row.delivery_fee_cents,
    taxCents: row.tax_cents,
    totalCents: row.total_cents,
    deliveryAddress: row.delivery_address ?? {},
    items: row.order_items.map((item) => ({
      productName: item.product_name,
      quantity: item.quantity,
      unitPriceCents: item.unit_price_cents,
    })),
  };
}

/** What the customer sees on their order confirmation page. */
export type CustomerOrder = OrderSummary & {
  status: string;
  totalWeight: number;
  paidAt: string | null;
};

type CustomerOrderRow = OrderRow & { status: string; total_weight: number; paid_at: string | null };

/**
 * Loads one of the customer's own orders. customerId must come from a verified
 * session; another customer's order returns null, the same as a missing one.
 */
export async function getCustomerOrder(db: SupabaseClient, customerId: string, orderId: string): Promise<CustomerOrder | null> {
  const { data, error } = await db
    .from("orders")
    .select(
      "id, status, subtotal_cents, delivery_fee_cents, tax_cents, total_cents, total_weight, paid_at, delivery_address, order_items(product_name, quantity, unit_price_cents)",
    )
    .eq("id", orderId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error) throw new Error(`loading order ${orderId} failed: ${error.message}`);
  if (!data) return null;
  const row = data as CustomerOrderRow;
  return {
    id: row.id,
    status: row.status,
    subtotalCents: row.subtotal_cents,
    deliveryFeeCents: row.delivery_fee_cents,
    taxCents: row.tax_cents,
    totalCents: row.total_cents,
    totalWeight: row.total_weight,
    paidAt: row.paid_at,
    deliveryAddress: row.delivery_address ?? {},
    items: row.order_items.map((item) => ({
      productName: item.product_name,
      quantity: item.quantity,
      unitPriceCents: item.unit_price_cents,
    })),
  };
}
