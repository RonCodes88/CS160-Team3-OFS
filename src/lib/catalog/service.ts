// The public catalog contract (#13): what GET /api/categories, GET /api/products
// and GET /api/products/[productId] return. The API routes and the /shop page
// both read through here, so the storefront always shows exactly what the API
// serves. Only active, in-stock products are public.

import { createAdminClient } from "@/lib/supabase/admin";
import { selectCategories, selectProduct, selectProducts } from "./db";
import type { CatalogCategory, CatalogProduct, ProductQuery } from "./types";

/** Active categories, sorted by name. */
export async function getCatalogCategories(): Promise<CatalogCategory[]> {
  return selectCategories(createAdminClient());
}

/** Active, in-stock products matching the query, sorted by name. */
export async function searchCatalogProducts(query: ProductQuery = {}): Promise<CatalogProduct[]> {
  return selectProducts(createAdminClient(), query);
}

/** One active, in-stock product, or null. */
export async function getCatalogProduct(productId: string): Promise<CatalogProduct | null> {
  return selectProduct(createAdminClient(), productId);
}
