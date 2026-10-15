import { describe, expect, it } from "vitest";
import { SAMPLE_PRODUCT_ROWS } from "./sampleCatalog";
import { getCatalogCategories, getCatalogProduct, searchCatalogProducts } from "./service";

const names = (products: { name: string }[]) => products.map((p) => p.name);
const CHEDDAR_ID = SAMPLE_PRODUCT_ROWS.find((p) => p.name === "Sharp Cheddar")!.id;
const GRANOLA_ID = SAMPLE_PRODUCT_ROWS.find((p) => p.name === "Discontinued Granola")!.id;
const MILK_ID = SAMPLE_PRODUCT_ROWS.find((p) => p.name === "Whole Milk")!.id;

describe("getCatalogCategories", () => {
  it("returns only active categories", async () => {
    expect((await getCatalogCategories()).map((c) => c.slug)).not.toContain("seasonal");
  });
});

describe("searchCatalogProducts", () => {
  it("returns only active, in-stock products", async () => {
    const products = await searchCatalogProducts();
    expect(products.every((p) => p.inStock)).toBe(true);
    expect(names(products)).not.toContain("Sharp Cheddar");
    expect(names(products)).not.toContain("Discontinued Granola");
    expect(products).toHaveLength(
      SAMPLE_PRODUCT_ROWS.filter((p) => p.is_active && p.stock_quantity > 0).length,
    );
  });

  it("applies search and category filters", async () => {
    expect(names(await searchCatalogProducts({ q: "cheddar" }))).toEqual([]);
    expect(names(await searchCatalogProducts({ category: "bakery" }))).toEqual([
      "Butter Croissants",
      "Sourdough Bread",
    ]);
  });
});

describe("getCatalogProduct", () => {
  it("returns an in-stock product by id", async () => {
    expect((await getCatalogProduct(MILK_ID))?.name).toBe("Whole Milk");
  });

  it("returns null for out-of-stock, retired, or unknown products", async () => {
    expect(await getCatalogProduct(CHEDDAR_ID)).toBeNull();
    expect(await getCatalogProduct(GRANOLA_ID)).toBeNull();
    expect(await getCatalogProduct("not-a-real-id")).toBeNull();
  });
});
