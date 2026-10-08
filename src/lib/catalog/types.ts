// Response shapes the storefront expects from the catalog API (#13).

export type CatalogCategory = {
  id: string;
  name: string;
  slug: string;
};

export type CatalogProduct = {
  id: string;
  sku: string;
  categoryId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  /** Integer cents. */
  priceCents: number;
  /** Hundredths of a pound. */
  unitWeight: number;
  /** The public catalog shows availability, not exact stock counts. */
  inStock: boolean;
};

/** Filters for listing products. Both are already normalized by parseShopQuery. */
export type ProductQuery = {
  q?: string;
  /** Category slug. */
  category?: string;
};
