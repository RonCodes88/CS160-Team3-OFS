import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogCategory, CatalogProduct, ProductQuery } from "./types";

// Catalog reads against the categories and products tables. Only active,
// in-stock products in active categories are public (#13).

type CategoryRow = { id: string; name: string; slug: string };

type ProductRow = {
  id: string;
  sku: string;
  category_id: string;
  name: string;
  description: string;
  image_url: string | null;
  price_cents: number;
  unit_weight: number;
};

// The inner join drops products whose category is retired or doesn't match.
const PRODUCT_COLUMNS =
  "id, sku, category_id, name, description, image_url, price_cents, unit_weight, category:categories!inner(slug)";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toProduct(row: ProductRow): CatalogProduct {
  return {
    id: row.id,
    sku: row.sku,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    priceCents: row.price_cents,
    unitWeight: row.unit_weight,
    // Only in-stock rows are selected; exact counts stay private.
    inStock: true,
  };
}

/**
 * Builds a PostgREST `or` filter matching name or description. Characters that
 * are filter syntax or wildcards are removed so input only matches literally.
 */
export function buildCatalogSearchFilter(search: string): string | null {
  const term = search.replace(/[%*\\"(),]/g, " ").replace(/\s+/g, " ").trim();
  if (!term) return null;
  return `name.ilike."*${term}*",description.ilike."*${term}*"`;
}

function publicProducts(db: SupabaseClient) {
  return db
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("is_active", true)
    .gt("stock_quantity", 0)
    .eq("category.is_active", true);
}

/** Active categories, sorted by name. */
export async function selectCategories(db: SupabaseClient): Promise<CatalogCategory[]> {
  const { data, error } = await db
    .from("categories")
    .select("id, name, slug")
    .eq("is_active", true)
    .order("name")
    .order("id");
  if (error) throw new Error(`selectCategories failed: ${error.message}`);
  return (data as CategoryRow[]).map(({ id, name, slug }) => ({ id, name, slug }));
}

/** Public products matching the query, sorted by name. */
export async function selectProducts(db: SupabaseClient, { q, category }: ProductQuery = {}): Promise<CatalogProduct[]> {
  let query = publicProducts(db);
  if (category) query = query.eq("category.slug", category);
  const filter = q ? buildCatalogSearchFilter(q) : null;
  if (filter) query = query.or(filter);

  const { data, error } = await query.order("name").order("id");
  if (error) throw new Error(`selectProducts failed: ${error.message}`);
  return (data as unknown as ProductRow[]).map(toProduct);
}

/** One public product, or null when it is unknown, retired, or out of stock. */
export async function selectProduct(db: SupabaseClient, productId: string): Promise<CatalogProduct | null> {
  if (!UUID.test(productId)) return null;
  const { data, error } = await publicProducts(db).eq("id", productId).maybeSingle();
  if (error) throw new Error(`selectProduct failed: ${error.message}`);
  return data ? toProduct(data as unknown as ProductRow) : null;
}
