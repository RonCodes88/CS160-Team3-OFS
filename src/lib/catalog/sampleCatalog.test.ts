import { describe, expect, it } from "vitest";
import { listCategories, listProducts, SAMPLE_PRODUCT_ROWS } from "./sampleCatalog";

const names = (products: { name: string }[]) => products.map((p) => p.name);

describe("listCategories", () => {
  it("returns only active categories, sorted by name", async () => {
    const categories = await listCategories();
    expect(categories.map((c) => c.slug)).not.toContain("seasonal");
    expect(categories.map((c) => c.name)).toEqual([...categories.map((c) => c.name)].sort());
  });
});

describe("listProducts", () => {
  it("never returns retired products", async () => {
    const products = await listProducts();
    expect(names(products)).not.toContain("Discontinued Granola");
    expect(products).toHaveLength(SAMPLE_PRODUCT_ROWS.filter((p) => p.is_active).length);
  });

  it("sorts by name", async () => {
    const products = await listProducts();
    expect(names(products)).toEqual([...names(products)].sort((a, b) => a.localeCompare(b)));
  });

  it("returns prices and weights as integers", async () => {
    for (const p of await listProducts()) {
      expect(Number.isSafeInteger(p.priceCents)).toBe(true);
      expect(Number.isSafeInteger(p.unitWeight)).toBe(true);
    }
  });

  it("reports availability without exposing stock counts", async () => {
    const products = await listProducts();
    const cheddar = products.find((p) => p.name === "Sharp Cheddar");
    expect(cheddar?.inStock).toBe(false);
    expect(products.find((p) => p.name === "Whole Milk")?.inStock).toBe(true);
    expect(cheddar).not.toHaveProperty("stockQuantity");
  });

  it("matches the name, ignoring case", async () => {
    expect(names(await listProducts({ q: "BANANA" }))).toEqual(["Organic Bananas"]);
  });

  it("matches the description", async () => {
    expect(names(await listProducts({ q: "durum" }))).toEqual(["Spaghetti"]);
  });

  it("does not match retired products by search", async () => {
    expect(await listProducts({ q: "granola" })).toEqual([]);
  });

  it("filters by category slug", async () => {
    expect(names(await listProducts({ category: "bakery" }))).toEqual(["Butter Croissants", "Sourdough Bread"]);
  });

  it("combines search and category", async () => {
    expect(names(await listProducts({ q: "bag", category: "produce" }))).toEqual([
      "Fuji Apples",
      "Hass Avocados",
      "Russet Potatoes",
    ]);
  });

  it("returns nothing for an unknown or retired category", async () => {
    expect(await listProducts({ category: "nope" })).toEqual([]);
    expect(await listProducts({ category: "seasonal" })).toEqual([]);
  });

  it("returns nothing when the search matches nothing", async () => {
    expect(await listProducts({ q: "zzz" })).toEqual([]);
  });
});
