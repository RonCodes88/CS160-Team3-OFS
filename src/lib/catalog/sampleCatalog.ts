// Stand-in for the catalog API (#13) until it lands. Rows mirror the
// categories and products tables; listCategories and listProducts return the
// shapes the storefront expects from GET /api/categories and
// GET /api/products. Replace their bodies with API calls once #13 merges.

import type { CatalogCategory, CatalogProduct, ProductQuery } from "./types";

type CategoryRow = { id: string; name: string; slug: string; is_active: boolean };

type ProductRow = {
  id: string;
  sku: string;
  category_id: string;
  name: string;
  description: string;
  image_url: string | null;
  price_cents: number;
  /** Hundredths of a pound. */
  unit_weight: number;
  stock_quantity: number;
  is_active: boolean;
};

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const PRODUCE = id(1);
const DAIRY = id(2);
const BAKERY = id(3);
const PANTRY = id(4);
const BEVERAGES = id(5);
const MEAT = id(6);

export const SAMPLE_CATEGORY_ROWS: readonly CategoryRow[] = [
  { id: PRODUCE, name: "Produce", slug: "produce", is_active: true },
  { id: DAIRY, name: "Dairy & Eggs", slug: "dairy-eggs", is_active: true },
  { id: BAKERY, name: "Bakery", slug: "bakery", is_active: true },
  { id: PANTRY, name: "Pantry", slug: "pantry", is_active: true },
  { id: BEVERAGES, name: "Beverages", slug: "beverages", is_active: true },
  { id: MEAT, name: "Meat & Seafood", slug: "meat-seafood", is_active: true },
  { id: id(7), name: "Seasonal", slug: "seasonal", is_active: false },
];

function product(
  n: number,
  category_id: string,
  name: string,
  description: string,
  price_cents: number,
  unit_weight: number,
  stock_quantity = 25,
  is_active = true,
): ProductRow {
  return {
    id: id(100 + n),
    sku: `OFS-${String(n).padStart(4, "0")}`,
    category_id,
    name,
    description,
    image_url: null,
    price_cents,
    unit_weight,
    stock_quantity,
    is_active,
  };
}

export const SAMPLE_PRODUCT_ROWS: readonly ProductRow[] = [
  product(1, PRODUCE, "Organic Bananas", "One bunch, about 6 bananas.", 249, 200),
  product(2, PRODUCE, "Fuji Apples", "3 lb bag of crisp, sweet apples.", 599, 300),
  product(3, PRODUCE, "Hass Avocados", "Bag of 4, ready to eat in a day or two.", 499, 150),
  product(4, PRODUCE, "Baby Spinach", "Pre-washed, 10 oz clamshell.", 399, 63),
  product(5, PRODUCE, "Russet Potatoes", "10 lb bag for mashing and baking.", 699, 1000),
  product(6, DAIRY, "Whole Milk", "One gallon, Grade A.", 499, 860),
  product(7, DAIRY, "Large Eggs", "One dozen cage-free brown eggs.", 549, 150),
  product(8, DAIRY, "Greek Yogurt", "Plain, 32 oz tub.", 649, 200),
  product(9, DAIRY, "Sharp Cheddar", "8 oz block, aged 9 months.", 449, 50, 0),
  product(10, BAKERY, "Sourdough Bread", "Fresh-baked loaf.", 699, 150),
  product(11, BAKERY, "Butter Croissants", "Pack of 4.", 599, 75),
  product(12, PANTRY, "Jasmine Rice", "20 lb bag.", 2499, 2000),
  product(13, PANTRY, "All-Purpose Flour", "50 lb bulk sack.", 3299, 5000),
  product(14, PANTRY, "Spaghetti", "1 lb box of durum wheat pasta.", 199, 100),
  product(15, PANTRY, "Marinara Sauce", "24 oz jar.", 549, 175),
  product(16, BEVERAGES, "Spring Water", "24-pack of 16.9 oz bottles.", 799, 3500),
  product(17, BEVERAGES, "Cold Brew Coffee", "32 oz bottle, unsweetened.", 899, 225),
  product(18, MEAT, "Chicken Breast", "Boneless, skinless, about 1.5 lb.", 1099, 150),
  product(19, MEAT, "Atlantic Salmon", "Fresh fillet, about 1 lb.", 1399, 100),
  product(20, PANTRY, "Discontinued Granola", "Retired product, never shown.", 599, 100, 10, false),
];

function toCategory(row: CategoryRow): CatalogCategory {
  return { id: row.id, name: row.name, slug: row.slug };
}

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
    inStock: row.stock_quantity > 0,
  };
}

/** Active categories, sorted by name. */
export async function listCategories(): Promise<CatalogCategory[]> {
  return SAMPLE_CATEGORY_ROWS.filter((c) => c.is_active)
    .map(toCategory)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Active products in active categories, sorted by name. `q` matches the name
 * or description, ignoring case; `category` is a category slug, and an unknown
 * or retired slug matches nothing.
 */
export async function listProducts({ q, category }: ProductQuery = {}): Promise<CatalogProduct[]> {
  const activeCategories = SAMPLE_CATEGORY_ROWS.filter((c) => c.is_active);
  const categoryIds = new Set(
    activeCategories.filter((c) => category === undefined || c.slug === category).map((c) => c.id),
  );
  const term = q?.toLowerCase();

  return SAMPLE_PRODUCT_ROWS.filter(
    (p) =>
      p.is_active &&
      categoryIds.has(p.category_id) &&
      (!term ||
        p.name.toLowerCase().includes(term) ||
        p.description.toLowerCase().includes(term)),
  )
    .map(toProduct)
    .sort((a, b) => a.name.localeCompare(b.name));
}
