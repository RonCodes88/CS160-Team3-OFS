import type { Metadata } from "next";
import { ProductGrid } from "@/components/shop/ProductGrid";
import { ShopCartProvider } from "@/components/shop/ShopCart";
import { ShopFilters } from "@/components/shop/ShopFilters";
import { StickyTag } from "@/components/ui/StickyTag";
import { parseShopQuery } from "@/lib/catalog/query";
import { listCategories, listProducts } from "@/lib/catalog/sampleCatalog";

export const metadata: Metadata = { title: "Shop — OFS" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = parseShopQuery(await searchParams);
  // TODO(#13): fetch from GET /api/categories and GET /api/products instead.
  const [categories, products] = await Promise.all([listCategories(), listProducts(query)]);
  const categoryName = categories.find((c) => c.slug === query.category)?.name;

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 md:py-16">
      <StickyTag>Sample catalog · live products coming soon</StickyTag>
      <h1 className="mt-4 text-4xl md:text-5xl">{categoryName ?? "Shop"}</h1>
      <p className="mt-2 text-lg text-pencil/70" aria-live="polite">
        {products.length} {products.length === 1 ? "product" : "products"}
        {query.q && <> matching &ldquo;{query.q}&rdquo;</>}
      </p>

      <ShopFilters query={query} categories={categories} />

      <ShopCartProvider>
        <ProductGrid products={products} categories={categories} />
      </ShopCartProvider>
    </section>
  );
}
