// The public catalog contract (#13): what GET /api/categories, GET /api/products
// and GET /api/products/[productId] return. The API routes and the /shop page
// both read through here, so the storefront always shows exactly what the API
// serves. Only active, in-stock products are public.

import { listCategories, listProducts } from "./sampleCatalog";
import type { CatalogCategory, CatalogProduct, ProductQuery } from "./types";

/** Active categories, sorted by name. */
export async function getCatalogCategories(): Promise<CatalogCategory[]> {
  return listCategories();
}

/** Active, in-stock products matching the query, sorted by name. */
export async function searchCatalogProducts(query: ProductQuery = {}): Promise<CatalogProduct[]> {
  return (await listProducts(query)).filter((product) => product.inStock);
}

/** One active, in-stock product, or null. */
export async function getCatalogProduct(productId: string): Promise<CatalogProduct | null> {
  return (await searchCatalogProducts()).find((product) => product.id === productId) ?? null;
}
