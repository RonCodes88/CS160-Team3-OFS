import type { SupabaseClient } from "@supabase/supabase-js";
import type { InventoryQuery, LowStockQuery } from "@/lib/inventory/validation";

// Stock lives in products.stock_quantity (single source of truth).

export type InventoryItem = {
  productId: string;
  sku: string;
  name: string;
  categoryId: string;
  description: string;
  imageUrl: string | null;
  /** Integer cents. */
  priceCents: number;
  /** Hundredths of a pound. */
  unitWeight: number;
  stockQuantity: number;
  updatedAt: string;
};

export type InventoryPage = { items: InventoryItem[]; hasMore: boolean };

export type QuantityChange = {
  productId: string;
  oldQuantity: number;
  newQuantity: number;
  changed: boolean;
  updatedAt: string;
};

export type SetQuantityResult =
  | { ok: true; value: QuantityChange }
  | { ok: false; reason: "NOT_FOUND" | "INVALID_QUANTITY" | "FORBIDDEN" }
  /** The stock is no longer what the caller was looking at. */
  | { ok: false; reason: "STALE"; currentQuantity: number | null };

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  category_id: string;
  description: string;
  image_url: string | null;
  price_cents: number;
  unit_weight: number;
  stock_quantity: number;
  updated_at: string;
};

type SetQuantityRow = {
  product_id: string;
  old_quantity: number;
  new_quantity: number;
  changed: boolean;
  updated_at: string;
};

// The editable product fields come along so the staff dashboard can prefill
// the manager's edit form without another request.
const INVENTORY_COLUMNS =
  "id, sku, name, category_id, description, image_url, price_cents, unit_weight, stock_quantity, updated_at";

function toItem(row: ProductRow): InventoryItem {
  return {
    productId: row.id,
    sku: row.sku,
    name: row.name,
    categoryId: row.category_id,
    description: row.description,
    imageUrl: row.image_url,
    priceCents: row.price_cents,
    unitWeight: row.unit_weight,
    stockQuantity: row.stock_quantity,
    updatedAt: row.updated_at,
  };
}

// Fetches one extra row to learn whether another page exists.
function toPage(rows: ProductRow[], limit: number): InventoryPage {
  return { items: rows.slice(0, limit).map(toItem), hasMore: rows.length > limit };
}

/**
 * Builds a PostgREST `or` filter matching name or SKU. Characters that are
 * filter syntax or wildcards are removed so input only matches literally.
 */
export function buildSearchFilter(search: string): string | null {
  const term = search.replace(/[%*\\"(),]/g, " ").replace(/\s+/g, " ").trim();
  if (!term) return null;
  return `name.ilike."*${term}*",sku.ilike."*${term}*"`;
}

/** Active products with their stock, sorted by name; `retired` lists retired ones instead. */
export async function listInventory(
  db: SupabaseClient,
  { search, limit, offset, retired = false }: InventoryQuery,
): Promise<InventoryPage> {
  let query = db.from("products").select(INVENTORY_COLUMNS).eq("is_active", !retired);
  const filter = buildSearchFilter(search);
  if (filter) query = query.or(filter);

  const { data, error } = await query
    .order("name")
    .order("id")
    .range(offset, offset + limit);
  if (error) throw new Error(`listInventory failed: ${error.message}`);
  return toPage(data as ProductRow[], limit);
}

/** Active products with stock_quantity <= threshold, lowest stock first. */
export async function listLowStock(
  db: SupabaseClient,
  { threshold, limit, offset }: LowStockQuery,
): Promise<InventoryPage> {
  const { data, error } = await db
    .from("products")
    .select(INVENTORY_COLUMNS)
    .eq("is_active", true)
    .lte("stock_quantity", threshold)
    .order("stock_quantity")
    .order("name")
    .order("id")
    .range(offset, offset + limit);
  if (error) throw new Error(`listLowStock failed: ${error.message}`);
  return toPage(data as ProductRow[], limit);
}

/**
 * Sets a product's stock and writes the audit row in one transaction
 * (see staff_set_inventory_quantity). actorUserId must come from the session.
 */
export async function setInventoryQuantity(
  db: SupabaseClient,
  actorUserId: string,
  productId: string,
  quantity: number,
  /** When given, the change is refused unless the stock still equals this. */
  expectedQuantity: number | null = null,
): Promise<SetQuantityResult> {
  const { data, error } = await db.rpc("staff_set_inventory_quantity", {
    p_actor_user_id: actorUserId,
    p_product_id: productId,
    p_quantity: quantity,
    p_expected_quantity: expectedQuantity,
  });

  if (error) {
    switch (error.code) {
      case "P0002":
        return { ok: false, reason: "NOT_FOUND" };
      case "22023":
        return { ok: false, reason: "INVALID_QUANTITY" };
      case "42501":
        return { ok: false, reason: "FORBIDDEN" };
      case "P0021": {
        const current = Number(error.details);
        return { ok: false, reason: "STALE", currentQuantity: Number.isInteger(current) ? current : null };
      }
      default:
        throw new Error(`staff_set_inventory_quantity failed: ${error.message}`);
    }
  }

  const row = data as SetQuantityRow;
  return {
    ok: true,
    value: {
      productId: row.product_id,
      oldQuantity: row.old_quantity,
      newQuantity: row.new_quantity,
      changed: row.changed,
      updatedAt: row.updated_at,
    },
  };
}
