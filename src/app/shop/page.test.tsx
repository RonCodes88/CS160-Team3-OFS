import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Page from "./page";
import * as catalog from "@/lib/catalog/sampleCatalog";

// Renders the real page (server component plus the client components' first
// render) to HTML, the same markup the browser receives before hydration.
async function render(params: { [key: string]: string | string[] | undefined } = {}) {
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}

describe("/shop page", () => {
  it("shows every active product with price, weight, and an add button", async () => {
    const html = await render();
    expect(html).toContain("19 products");
    expect(html).toContain("Whole Milk");
    expect(html).toContain("$4.99");
    expect(html).toContain("8.60 lb");
    expect(html).toContain('aria-label="Add Whole Milk to cart"');
    expect(html).not.toContain("Discontinued Granola");
  });

  it("disables the add button for out-of-stock products", async () => {
    const html = await render({ q: "cheddar" });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Add Sharp Cheddar to cart"/);
    expect(html).toContain("Out of stock");
  });

  it("filters by search and keeps the search in the box", async () => {
    const html = await render({ q: "banana" });
    expect(html).toContain("1 product");
    expect(html).toContain("matching “banana”");
    expect(html).toContain('value="banana"');
    expect(html).toContain("Organic Bananas");
    expect(html).not.toContain("Whole Milk");
  });

  it("filters by category, titles the page, and marks the chip current", async () => {
    const html = await render({ category: "bakery" });
    expect(html).toMatch(/<h1[^>]*>Bakery<\/h1>/);
    expect(html).toMatch(/aria-current="page"[^>]*>Bakery</);
    expect(html).toContain("Sourdough Bread");
    expect(html).not.toContain("Organic Bananas");
  });

  it("keeps the category when searching and the search when switching category", async () => {
    const html = await render({ q: "milk", category: "dairy-eggs" });
    expect(html).toContain('<input type="hidden" name="category" value="dairy-eggs"/>');
    expect(html).toContain('href="/shop?q=milk&amp;category=produce"');
    expect(html).toContain('href="/shop?q=milk"');
  });

  it("shows an empty state with a way back when nothing matches", async () => {
    const html = await render({ q: "zzz" });
    expect(html).toContain("0 products");
    expect(html).toContain("No products match.");
    expect(html).toContain('href="/shop"');
  });

  it("ignores a malformed category instead of failing", async () => {
    const html = await render({ category: "../etc" });
    expect(html).toContain("19 products");
  });

  it("lets catalog errors reach the error boundary", async () => {
    vi.spyOn(catalog, "listProducts").mockRejectedValueOnce(new Error("catalog down"));
    await expect(render()).rejects.toThrow("catalog down");
  });
});
