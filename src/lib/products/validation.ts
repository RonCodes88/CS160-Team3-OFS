// Input parsing for the manager product API. Requests use camelCase; parsers
// return the snake_case columns the admin_* database functions expect.

import { MAX_CART_WEIGHT } from "@/lib/cart/pricing";
import { isUuid, PG_INT_MAX, type Parsed } from "@/lib/inventory/validation";

export const MAX_SKU_LENGTH = 64;
export const MAX_NAME_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_IMAGE_URL_LENGTH = 2048;

/** Editable product columns. Stock and is_active have their own endpoints. */
export type ProductFields = {
  sku: string;
  category_id: string;
  name: string;
  description: string;
  image_url: string | null;
  price_cents: number;
  unit_weight: number;
};

export type NewProduct = ProductFields & { stock_quantity: number };
export type ProductChanges = Partial<ProductFields>;

type Field = { column: keyof ProductFields; parse: (value: unknown) => Parsed<unknown> };

function requiredText(name: string, max: number) {
  return (value: unknown): Parsed<string> => {
    if (typeof value !== "string") return { ok: false, message: `${name} must be text.` };
    const text = value.trim();
    if (!text) return { ok: false, message: `${name} cannot be blank.` };
    if (text.length > max) return { ok: false, message: `${name} must be at most ${max} characters.` };
    return { ok: true, value: text };
  };
}

function parseDescription(value: unknown): Parsed<string> {
  if (typeof value !== "string") return { ok: false, message: "description must be text." };
  const text = value.trim();
  if (text.length > MAX_DESCRIPTION_LENGTH) {
    return { ok: false, message: `description must be at most ${MAX_DESCRIPTION_LENGTH} characters.` };
  }
  return { ok: true, value: text };
}

/** null or "" clears the image; otherwise an http(s) URL. */
function parseImageUrl(value: unknown): Parsed<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, message: "imageUrl must be a URL or null." };
  const text = value.trim();
  if (!text) return { ok: true, value: null };
  if (text.length > MAX_IMAGE_URL_LENGTH) return { ok: false, message: "imageUrl is too long." };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, message: "imageUrl must be a valid URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, message: "imageUrl must start with http:// or https://." };
  }
  return { ok: true, value: text };
}

function parseCategoryId(value: unknown): Parsed<string> {
  if (typeof value !== "string" || !isUuid(value)) {
    return { ok: false, message: "categoryId must be a UUID." };
  }
  return { ok: true, value: value.toLowerCase() };
}

function wholeNumber(name: string, min: number, max: number, hint = "") {
  return (value: unknown): Parsed<number> => {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return { ok: false, message: `${name} must be a whole number${hint}.` };
    }
    if (value < min || value > max) {
      return { ok: false, message: `${name} must be between ${min} and ${max}${hint}.` };
    }
    return { ok: true, value };
  };
}

// Money is integer cents; weight is integer hundredths of a pound. A single
// unit heavier than the max cart weight could never be ordered.
const FIELDS: Record<string, Field> = {
  sku: { column: "sku", parse: requiredText("sku", MAX_SKU_LENGTH) },
  categoryId: { column: "category_id", parse: parseCategoryId },
  name: { column: "name", parse: requiredText("name", MAX_NAME_LENGTH) },
  description: { column: "description", parse: parseDescription },
  imageUrl: { column: "image_url", parse: parseImageUrl },
  priceCents: { column: "price_cents", parse: wholeNumber("priceCents", 0, PG_INT_MAX, " (cents)") },
  unitWeight: {
    column: "unit_weight",
    parse: wholeNumber("unitWeight", 1, MAX_CART_WEIGHT, " (hundredths of a pound)"),
  },
};

const REQUIRED_ON_CREATE = ["sku", "categoryId", "name", "priceCents", "unitWeight"];

const parseInitialStock = wholeNumber("stockQuantity", 0, PG_INT_MAX);

// Fields that exist on a product but are changed through another endpoint.
const READ_ONLY_HINTS: Record<string, string> = {
  stockQuantity: "stockQuantity can't be changed here; use PUT /api/staff/inventory/:productId.",
  isActive: "isActive can't be changed here; use DELETE /api/admin/products/:productId to retire.",
};

function asObject(body: unknown): Parsed<Record<string, unknown>> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "Body must be a JSON object." };
  }
  return { ok: true, value: body as Record<string, unknown> };
}

function rejectUnknownKeys(body: Record<string, unknown>, allowed: string[]): Parsed<null> {
  for (const key of Object.keys(body)) {
    if (allowed.includes(key)) continue;
    return { ok: false, message: READ_ONLY_HINTS[key] ?? `Unknown field: ${key}.` };
  }
  return { ok: true, value: null };
}

/** Body for POST /api/admin/products. */
export function parseNewProduct(body: unknown): Parsed<NewProduct> {
  const object = asObject(body);
  if (!object.ok) return object;
  const input = object.value;

  const unknown = rejectUnknownKeys(input, [...Object.keys(FIELDS), "stockQuantity"]);
  if (!unknown.ok) return unknown;

  for (const key of REQUIRED_ON_CREATE) {
    if (input[key] === undefined) return { ok: false, message: `${key} is required.` };
  }

  const product: Record<string, unknown> = { description: "", image_url: null, stock_quantity: 0 };
  for (const [key, field] of Object.entries(FIELDS)) {
    if (input[key] === undefined) continue;
    const parsed = field.parse(input[key]);
    if (!parsed.ok) return parsed;
    product[field.column] = parsed.value;
  }
  if (input.stockQuantity !== undefined) {
    const stock = parseInitialStock(input.stockQuantity);
    if (!stock.ok) return stock;
    product.stock_quantity = stock.value;
  }
  return { ok: true, value: product as NewProduct };
}

/** Body for PUT /api/admin/products/:productId. Any subset of editable fields. */
export function parseProductChanges(body: unknown): Parsed<ProductChanges> {
  const object = asObject(body);
  if (!object.ok) return object;
  const input = object.value;

  const unknown = rejectUnknownKeys(input, Object.keys(FIELDS));
  if (!unknown.ok) return unknown;

  const changes: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(FIELDS)) {
    if (input[key] === undefined) continue;
    const parsed = field.parse(input[key]);
    if (!parsed.ok) return parsed;
    changes[field.column] = parsed.value;
  }
  if (Object.keys(changes).length === 0) {
    return { ok: false, message: "Send at least one field to change." };
  }
  return { ok: true, value: changes as ProductChanges };
}
