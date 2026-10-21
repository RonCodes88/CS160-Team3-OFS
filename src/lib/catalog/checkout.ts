import type { SupabaseClient } from "@supabase/supabase-js";

type ProductRow = {
  id: string; is_active: boolean; price_cents: number; unit_weight: number; stock_quantity: number;
  category: { is_active: boolean } | null;
};

/**
 * Batch-load current product data for checkout, including unavailable products.
 * Public browsing filters those out and exposes only an in-stock flag; checkout
 * needs exact quantities to distinguish enough stock from merely some stock.
 * This helper is internal and does not change the public catalog response.
 */
export async function getCheckoutProducts(db: SupabaseClient, productIds: readonly string[]) {
  if (!productIds.length) return [];
  const { data, error } = await db.from("products")
    .select("id, is_active, price_cents, unit_weight, stock_quantity, category:categories(is_active)")
    .in("id", [...new Set(productIds)]);
  if (error) throw new Error(`getCheckoutProducts failed: ${error.message}`);
  // Do not filter zero stock: the validator must distinguish insufficient stock.
  return (data as unknown as ProductRow[]).map((row) => ({
    id: row.id,
    // Fold category retirement into availability so the validator uses one rule.
    // A missing category also makes the product unavailable.
    isActive: row.is_active && row.category?.is_active === true,
    unitPriceCents: row.price_cents,
    unitWeight: row.unit_weight,
    stockQuantity: row.stock_quantity,
  }));
}
