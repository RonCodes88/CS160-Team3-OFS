import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as categories } from "@/app/api/categories/route";
import { GET as products } from "./route";
import { GET as product } from "./[productId]/route";

vi.mock("@/lib/catalog/service", () => ({
  getCatalogCategories: vi.fn(() => { throw new Error("private database details"); }),
  searchCatalogProducts: vi.fn(() => { throw new Error("private database details"); }),
  getCatalogProduct: vi.fn(() => { throw new Error("private database details"); }),
}));

afterEach(() => vi.restoreAllMocks());

describe("catalog provider failures", () => {
  it.each(["categories", "products", "product"])("returns a safe JSON error for %s", async (name) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const request = new Request("http://localhost/api/products");
    const response = await (name === "categories" ? categories()
      : name === "products" ? products(request)
      : product(request, { params: Promise.resolve({ productId: "unknown" }) }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } });
  });
});
