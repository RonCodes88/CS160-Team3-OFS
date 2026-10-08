// The shop's filters live in the URL (?q=...&category=...) so a filtered view
// can be shared or bookmarked.

import type { ProductQuery } from "./types";

export const MAX_SEARCH_LENGTH = 100;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type SearchParams = { [key: string]: string | string[] | undefined };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Reads the shop filters from search params, dropping empty or malformed values. */
export function parseShopQuery(params: SearchParams): ProductQuery {
  const query: ProductQuery = {};

  const q = first(params.q)?.replace(/\s+/g, " ").trim().slice(0, MAX_SEARCH_LENGTH).trim();
  if (q) query.q = q;

  const category = first(params.category)?.trim().toLowerCase();
  if (category && SLUG.test(category)) query.category = category;

  return query;
}

/** Link to the shop with the given filters; empty filters are left out. */
export function shopHref({ q, category }: ProductQuery): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  const search = params.toString();
  return search ? `/shop?${search}` : "/shop";
}
