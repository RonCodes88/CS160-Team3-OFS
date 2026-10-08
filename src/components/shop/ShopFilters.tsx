import Link from "next/link";
import { Search } from "lucide-react";
import { MAX_SEARCH_LENGTH, shopHref } from "@/lib/catalog/query";
import type { CatalogCategory, ProductQuery } from "@/lib/catalog/types";

const chip = "inline-block rounded-wobbly border-2 border-pencil px-4 py-1 text-lg shadow-hard-sm transition-colors";

/**
 * Search box and category chips. A plain GET form, so filtering works before
 * any JavaScript loads and the URL always reflects the current filters.
 */
export function ShopFilters({ query, categories }: { query: ProductQuery; categories: readonly CatalogCategory[] }) {
  return (
    <div className="mt-6 space-y-4">
      <form action="/shop" method="get" role="search" className="flex gap-2">
        <label htmlFor="shop-search" className="sr-only">
          Search products
        </label>
        <input
          id="shop-search"
          type="search"
          name="q"
          defaultValue={query.q ?? ""}
          maxLength={MAX_SEARCH_LENGTH}
          placeholder="Search bananas, rice, coffee..."
          className="h-12 min-w-0 flex-1 rounded-wobbly border-2 border-pencil bg-white px-4 text-lg placeholder:text-pencil/40 focus:border-pen focus:outline-none focus:ring-2 focus:ring-pen/20"
        />
        {query.category && <input type="hidden" name="category" value={query.category} />}
        <button
          type="submit"
          className="inline-flex h-12 items-center gap-2 rounded-wobbly border-[3px] border-pencil bg-white px-4 text-lg shadow-hard transition-all duration-100 hover:bg-pen hover:text-white active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
        >
          <Search aria-hidden strokeWidth={3} className="h-4 w-4" />
          Search
        </button>
      </form>

      <nav aria-label="Categories">
        <ul className="flex flex-wrap gap-2">
          <li>
            <CategoryChip href={shopHref({ q: query.q })} active={!query.category} label="All" />
          </li>
          {categories.map((c) => (
            <li key={c.id}>
              <CategoryChip
                href={shopHref({ q: query.q, category: c.slug })}
                active={query.category === c.slug}
                label={c.name}
              />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function CategoryChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`${chip} ${active ? "bg-pencil text-white" : "bg-white hover:bg-postit"}`}
    >
      {label}
    </Link>
  );
}
