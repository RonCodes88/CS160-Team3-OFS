// Input parsing for the staff inventory API. Everything from the client is
// untrusted, so each parser returns either a clean value or a message.

export const DEFAULT_LOW_STOCK_THRESHOLD = 10;
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;
export const MAX_SEARCH_LENGTH = 100;

// Largest value a Postgres INTEGER column can hold.
export const PG_INT_MAX = 2_147_483_647;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export type InventoryQuery = { search: string; limit: number; offset: number };
export type LowStockQuery = { threshold: number; limit: number; offset: number };

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Parses `{ "quantity": <whole number >= 0> }`. Strings like "5" are rejected. */
export function parseQuantityBody(body: unknown): Parsed<number> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "Body must be a JSON object like { \"quantity\": 12 }." };
  }
  const quantity = (body as Record<string, unknown>).quantity;
  if (typeof quantity !== "number" || !Number.isInteger(quantity)) {
    return { ok: false, message: "quantity must be a whole number." };
  }
  if (quantity < 0) return { ok: false, message: "quantity cannot be negative." };
  if (quantity > PG_INT_MAX) return { ok: false, message: "quantity is too large." };
  return { ok: true, value: quantity };
}

function parseWholeNumberParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
): Parsed<number> {
  const raw = params.get(name);
  if (raw === null || raw === "") return { ok: true, value: fallback };
  if (!/^\d+$/.test(raw)) {
    return { ok: false, message: `${name} must be a whole number.` };
  }
  const value = Number(raw);
  if (value < min || value > max) {
    return { ok: false, message: `${name} must be between ${min} and ${max}.` };
  }
  return { ok: true, value };
}

export function parsePage(params: URLSearchParams): Parsed<{ limit: number; offset: number }> {
  const limit = parseWholeNumberParam(params, "limit", DEFAULT_PAGE_LIMIT, 1, MAX_PAGE_LIMIT);
  if (!limit.ok) return limit;
  const offset = parseWholeNumberParam(params, "offset", 0, 0, PG_INT_MAX);
  if (!offset.ok) return offset;
  return { ok: true, value: { limit: limit.value, offset: offset.value } };
}

/** `?q=&limit=&offset=` for GET /api/staff/inventory. */
export function parseInventoryQuery(params: URLSearchParams): Parsed<InventoryQuery> {
  const search = (params.get("q") ?? "").trim();
  if (search.includes("\u0000")) {
    return { ok: false, message: "q cannot contain NUL characters." };
  }
  if (search.length > MAX_SEARCH_LENGTH) {
    return { ok: false, message: `q must be at most ${MAX_SEARCH_LENGTH} characters.` };
  }
  const page = parsePage(params);
  if (!page.ok) return page;
  return { ok: true, value: { search, ...page.value } };
}

/** `?threshold=&limit=&offset=` for GET /api/staff/inventory/low-stock. */
export function parseLowStockQuery(params: URLSearchParams): Parsed<LowStockQuery> {
  const threshold = parseWholeNumberParam(
    params,
    "threshold",
    DEFAULT_LOW_STOCK_THRESHOLD,
    0,
    PG_INT_MAX,
  );
  if (!threshold.ok) return threshold;
  const page = parsePage(params);
  if (!page.ok) return page;
  return { ok: true, value: { threshold: threshold.value, ...page.value } };
}
