import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Page, { generateMetadata } from "./page";
import { SAMPLE_PRODUCT_ROWS } from "@/lib/catalog/sampleCatalog";

// Unit tests read the in-memory catalog; catalog.db.test.ts covers the real queries.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/catalog/db", async () => (await import("@/lib/catalog/sampleCatalog")).sampleCatalogDb);

const idOf = (name: string) => SAMPLE_PRODUCT_ROWS.find((p) => p.name === name)!.id;

async function render(productId: string) {
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ productId }), searchParams: Promise.resolve({}) }));
}

describe("/shop/[productId] page", () => {
  it("shows the product's name, price, weight, description, and an add button", async () => {
    const html = await render(idOf("Whole Milk"));
    expect(html).toMatch(/<h1[^>]*>Whole Milk<\/h1>/);
    expect(html).toContain("$4.99");
    expect(html).toContain("8.60 lb each");
    expect(html).toContain("One gallon, Grade A.");
    expect(html).toContain("In stock");
    expect(html).toContain('aria-label="Add Whole Milk to cart"');
  });

  it("links back to the shop and the product's category", async () => {
    const html = await render(idOf("Whole Milk"));
    expect(html).toContain('href="/shop"');
    expect(html).toContain('href="/shop?category=dairy-eggs"');
    expect(html).toMatch(/aria-current="page"[^>]*>Whole Milk</);
  });

  it("explains the delivery fee and weight limit", async () => {
    const html = await render(idOf("Whole Milk"));
    expect(html).toContain("free when your order weighs under 20.00 lb");
    expect(html).toContain("$10.00 at 20.00 lb or more");
    expect(html).toContain("up to 200.00 lb");
  });

  it("suggests other in-stock products from the same category, not itself", async () => {
    const html = await render(idOf("Whole Milk"));
    expect(html).toContain("More in Dairy &amp; Eggs");
    expect(html).toContain(`href="/shop/${idOf("Large Eggs")}"`);
    expect(html).toContain(`href="/shop/${idOf("Greek Yogurt")}"`);
    expect(html).not.toContain(`href="/shop/${idOf("Whole Milk")}"`);
    expect(html).not.toContain("Sharp Cheddar");
    expect(html).not.toContain("Organic Bananas");
  });

  it.each([
    ["an unknown ID", "00000000-0000-4000-8000-000000000000"],
    ["a malformed ID", "not-a-uuid"],
    ["a retired product", idOf("Discontinued Granola")],
    ["an out-of-stock product", idOf("Sharp Cheddar")],
  ])("shows not found for %s", async (_, productId) => {
    await expect(render(productId)).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("titles the page with the product name", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ productId: idOf("Spaghetti") }),
      searchParams: Promise.resolve({}),
    });
    expect(meta.title).toBe("Spaghetti — OFS");
  });
});
