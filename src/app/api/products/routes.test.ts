import { describe, expect, it, vi } from "vitest";
import { GET as getCategories } from "@/app/api/categories/route";
import { GET as getProduct } from "./[productId]/route";
import { GET as getProducts } from "./route";
import { SAMPLE_PRODUCT_ROWS } from "@/lib/catalog/sampleCatalog";
import type { CatalogCategory, CatalogProduct } from "@/lib/catalog/types";

// Unit tests read the in-memory catalog; catalog.db.test.ts covers the real queries.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/catalog/db", async () => (await import("@/lib/catalog/sampleCatalog")).sampleCatalogDb);

const idOf = (name: string) => SAMPLE_PRODUCT_ROWS.find((p) => p.name === name)!.id;

async function listProducts(search = "") {
  const res = await getProducts(new Request(`http://localhost/api/products${search}`));
  expect(res.status).toBe(200);
  return ((await res.json()) as { products: CatalogProduct[] }).products;
}

async function product(id: string) {
  return getProduct(new Request(`http://localhost/api/products/${id}`), {
    params: Promise.resolve({ productId: id }),
  });
}

describe("GET /api/categories", () => {
  it("lists active categories", async () => {
    const res = await getCategories();
    expect(res.status).toBe(200);
    const { categories } = (await res.json()) as { categories: CatalogCategory[] };
    expect(categories.map((c) => c.slug)).toContain("bakery");
    expect(categories.map((c) => c.slug)).not.toContain("seasonal");
  });
});

describe("GET /api/products", () => {
  it("lists only active, in-stock products", async () => {
    const products = await listProducts();
    expect(products.map((p) => p.name)).toContain("Whole Milk");
    expect(products.map((p) => p.name)).not.toContain("Sharp Cheddar");
    expect(products.map((p) => p.name)).not.toContain("Discontinued Granola");
  });

  it("supports q and category", async () => {
    expect((await listProducts("?q=banana")).map((p) => p.name)).toEqual(["Organic Bananas"]);
    expect((await listProducts("?category=bakery")).map((p) => p.name)).toEqual([
      "Butter Croissants",
      "Sourdough Bread",
    ]);
  });

  it("ignores a malformed category", async () => {
    expect(await listProducts("?category=../etc")).toEqual(await listProducts());
  });

  it("returns integer cents and weights, and no stock counts", async () => {
    for (const p of await listProducts()) {
      expect(Number.isSafeInteger(p.priceCents)).toBe(true);
      expect(Number.isSafeInteger(p.unitWeight)).toBe(true);
      expect(p).not.toHaveProperty("stockQuantity");
    }
  });
});

describe("GET /api/products/[productId]", () => {
  it("returns an in-stock product", async () => {
    const res = await product(idOf("Whole Milk"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { product: CatalogProduct }).product.name).toBe("Whole Milk");
  });

  it("returns 404 for out-of-stock, retired, and unknown products", async () => {
    for (const id of [idOf("Sharp Cheddar"), idOf("Discontinued Granola"), "nope"]) {
      const res = await product(id);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: { code: "PRODUCT_NOT_FOUND", message: "Product not found." } });
    }
  });
});
