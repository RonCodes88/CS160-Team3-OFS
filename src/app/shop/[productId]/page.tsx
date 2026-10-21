import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Check, ChevronRight, Truck } from "lucide-react";
import { ProductImage, ProductList, categoryIcon } from "@/components/shop/ProductGrid";
import { AddToCartControl, ShopCartProvider } from "@/components/shop/ShopCart";
import { formatCents, formatWeight } from "@/lib/cart/format";
import { DELIVERY_FEE_CENTS, FREE_DELIVERY_WEIGHT_LIMIT, MAX_CART_WEIGHT } from "@/lib/cart/pricing";
import { shopHref } from "@/lib/catalog/query";
import { getCatalogCategories, getCatalogProduct, searchCatalogProducts } from "@/lib/catalog/service";

/** How many other products from the same category to suggest. */
const RELATED_LIMIT = 4;

// Metadata and the page both need the product; read it once per request.
const loadProduct = cache(getCatalogProduct);

export async function generateMetadata({ params }: PageProps<"/shop/[productId]">): Promise<Metadata> {
  const product = await loadProduct((await params).productId);
  return { title: product ? `${product.name} — OFS` : "Product not found — OFS" };
}

export default async function Page({ params }: PageProps<"/shop/[productId]">) {
  // Same data as GET /api/products/[productId]: only active, in-stock products.
  const product = await loadProduct((await params).productId);
  if (!product) notFound();

  const categories = await getCatalogCategories();
  const category = categories.find((c) => c.id === product.categoryId);
  const related = category
    ? (await searchCatalogProducts({ category: category.slug }))
        .filter((p) => p.id !== product.id)
        .slice(0, RELATED_LIMIT)
    : [];
  const Icon = categoryIcon(category?.slug);

  return (
    <ShopCartProvider>
      <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 md:py-12">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-lg">
            <li>
              <Link href="/shop" className="underline decoration-marker underline-offset-4 hover:wavy-underline">
                Shop
              </Link>
            </li>
            {category && (
              <li className="flex items-center gap-1">
                <ChevronRight aria-hidden strokeWidth={2.5} className="h-4 w-4" />
                <Link
                  href={shopHref({ category: category.slug })}
                  className="underline decoration-marker underline-offset-4 hover:wavy-underline"
                >
                  {category.name}
                </Link>
              </li>
            )}
            <li className="flex min-w-0 items-center gap-1">
              <ChevronRight aria-hidden strokeWidth={2.5} className="h-4 w-4 shrink-0" />
              <span aria-current="page" className="truncate text-pencil/80">
                {product.name}
              </span>
            </li>
          </ol>
        </nav>

        <div className="mt-6 grid gap-8 md:grid-cols-2 md:gap-12">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-wobbly-md border-2 border-pencil bg-white shadow-hard">
            <ProductImage product={product} Icon={Icon} iconClassName="h-32 w-32 md:h-40 md:w-40" />
          </div>

          <div className="flex flex-col">
            <h1 className="text-4xl leading-tight md:text-5xl">{product.name}</h1>
            <p className="mt-4 font-heading text-4xl tabular-nums">{formatCents(product.priceCents)}</p>
            <p className="mt-1 text-xl text-pencil/80 tabular-nums">{formatWeight(product.unitWeight)} each</p>
            <p className="mt-3 inline-flex items-center gap-2 text-lg">
              <Check aria-hidden strokeWidth={3} className="h-5 w-5 text-pen" />
              In stock
            </p>

            <p className="mt-6 text-xl leading-relaxed">{product.description}</p>

            <div className="mt-8 max-w-sm">
              <AddToCartControl product={product} size="lg" />
            </div>

            <aside
              aria-label="Delivery"
              className="mt-8 flex gap-3 rounded-wobbly-md border-2 border-dashed border-pencil bg-white/60 p-4 text-lg"
            >
              <Truck aria-hidden strokeWidth={2.5} className="mt-1 h-6 w-6 shrink-0" />
              <p>
                Delivered by robot from our Downtown San Jose store. Delivery is free when your order weighs under{" "}
                {formatWeight(FREE_DELIVERY_WEIGHT_LIMIT)}, and {formatCents(DELIVERY_FEE_CENTS)} at{" "}
                {formatWeight(FREE_DELIVERY_WEIGHT_LIMIT)} or more. Orders can weigh up to{" "}
                {formatWeight(MAX_CART_WEIGHT)}.
              </p>
            </aside>
          </div>
        </div>

        {category && related.length > 0 && (
          <section aria-labelledby="related-heading" className="mt-16">
            <h2 id="related-heading" className="text-3xl">
              More in {category.name}
            </h2>
            <ProductList products={related} categories={categories} />
          </section>
        )}
      </section>
    </ShopCartProvider>
  );
}
