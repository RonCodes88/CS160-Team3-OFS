import Link from "next/link";
import { Apple, Beef, Carrot, Croissant, CupSoda, Milk, Package, SearchX, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { formatCents, formatWeight } from "@/lib/cart/format";
import type { CatalogCategory, CatalogProduct } from "@/lib/catalog/types";
import { AddToCartButton } from "./ShopCart";

// Drawn in place of a photo until products have images.
const categoryIcons: Record<string, LucideIcon> = {
  produce: Carrot,
  "dairy-eggs": Milk,
  bakery: Croissant,
  pantry: Package,
  beverages: CupSoda,
  "meat-seafood": Beef,
};

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

  const slugById = new Map(categories.map((c) => [c.id, c.slug]));

  return (
    <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} Icon={categoryIcons[slugById.get(product.categoryId) ?? ""] ?? Apple} />
        </li>
      ))}
    </ul>
  );
}

function ProductCard({ product, Icon }: { product: CatalogProduct; Icon: LucideIcon }) {
  return (
    <article className="flex h-full flex-col rounded-wobbly-md border-2 border-pencil bg-white p-4 shadow-soft">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-wobbly border-2 border-dashed border-pencil/40 bg-paper">
        {product.imageUrl ? (
          // Plain <img>: product images come from the catalog and may be on any host.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Icon aria-hidden strokeWidth={1.75} className="h-16 w-16 text-pencil/70" />
        )}
      </div>
      <h2 className="mt-4 text-2xl">{product.name}</h2>
      <p className="mt-1 flex-1 text-base text-pencil/70">{product.description}</p>
      <div className="mt-4 flex items-end justify-between gap-2">
        <div>
          <p className="font-heading text-2xl tabular-nums">{formatCents(product.priceCents)}</p>
          <p className="text-base text-pencil/70 tabular-nums">{formatWeight(product.unitWeight)}</p>
        </div>
        <AddToCartButton product={product} />
      </div>
    </article>
  );
}
