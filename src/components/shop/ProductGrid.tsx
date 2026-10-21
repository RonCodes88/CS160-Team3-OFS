import Link from "next/link";
import { Apple, Beef, Carrot, Croissant, CupSoda, Milk, Package, SearchX, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { formatCents, formatWeight } from "@/lib/cart/format";
import type { CatalogCategory, CatalogProduct } from "@/lib/catalog/types";
import { AddToCartControl } from "./ShopCart";

// Drawn in place of a photo until products have images.
const categoryIcons: Record<string, LucideIcon> = {
  produce: Carrot,
  "dairy-eggs": Milk,
  bakery: Croissant,
  pantry: Package,
  beverages: CupSoda,
  "meat-seafood": Beef,
};

export function categoryIcon(slug: string | undefined): LucideIcon {
  return categoryIcons[slug ?? ""] ?? Apple;
}

/** Product page URL. */
export function productHref(productId: string): string {
  return `/shop/${productId}`;
}

/** The product photo, or its category's icon when there is none. */
export function ProductImage({
  product,
  Icon,
  iconClassName,
}: {
  product: CatalogProduct;
  Icon: LucideIcon;
  iconClassName: string;
}) {
  return product.imageUrl ? (
    // Plain <img>: product images come from the catalog and may be on any host.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
  ) : (
    <Icon aria-hidden strokeWidth={1.75} className={`text-pencil/70 ${iconClassName}`} />
  );
}

type Props = {
  products: readonly CatalogProduct[];
  categories: readonly CatalogCategory[];
};

export function ProductGrid({ products, categories }: Props) {
  if (products.length === 0) {
    return (
      <Card className="mt-8 text-center">
        <SearchX aria-hidden strokeWidth={2.5} className="mx-auto h-12 w-12" />
        <p className="mt-4 text-2xl">No products match.</p>
        <p className="mt-2 text-lg">
          Try another search or{" "}
          <Link href="/shop" className="underline decoration-marker">
            show everything
          </Link>
          .
        </p>
      </Card>
    );
  }

  return <ProductList products={products} categories={categories} />;
}

/** Two columns on phones, up to four on wide screens. */
export function ProductList({ products, categories }: Props) {
  const slugById = new Map(categories.map((c) => [c.id, c.slug]));

  return (
    <ul className="mt-8 grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} Icon={categoryIcon(slugById.get(product.categoryId))} />
        </li>
      ))}
    </ul>
  );
}

function ProductCard({ product, Icon }: { product: CatalogProduct; Icon: LucideIcon }) {
  return (
    // The name's link covers the whole card; the cart control sits above it.
    <article className="group relative flex h-full flex-col rounded-wobbly-md border-2 border-pencil bg-white p-3 shadow-soft transition-all duration-100 hover:-translate-y-0.5 hover:shadow-hard has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-3 has-[a:focus-visible]:outline-pen sm:p-4">
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-wobbly border-2 border-dashed border-pencil/40 bg-paper">
        <ProductImage product={product} Icon={Icon} iconClassName="h-14 w-14 sm:h-16 sm:w-16" />
      </div>
      <p className="mt-3 font-heading text-2xl tabular-nums">{formatCents(product.priceCents)}</p>
      <h2 className="mt-1 text-xl leading-snug sm:text-2xl">
        <Link
          href={productHref(product.id)}
          className="decoration-marker after:absolute after:inset-0 after:content-[''] focus-visible:outline-none group-hover:underline"
        >
          {product.name}
        </Link>
      </h2>
      <p className="mt-1 line-clamp-2 text-lg leading-snug text-pencil/80">{product.description}</p>
      <p className="mt-1 mb-3 flex-1 text-base text-pencil/80 tabular-nums">{formatWeight(product.unitWeight)} each</p>
      <div className="relative z-10">
        <AddToCartControl product={product} />
      </div>
    </article>
  );
}
