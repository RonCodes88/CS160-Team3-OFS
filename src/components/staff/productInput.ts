// Turns the manager's product form into API request bodies. Dollars and pounds
// are parsed as text into integer cents and hundredths, never through a float.
// These checks only give quick feedback; the API validates everything again.

import { MAX_CART_WEIGHT } from "@/lib/cart/pricing";
import { DEFAULT_LOW_STOCK_THRESHOLD, PG_INT_MAX, type Parsed } from "@/lib/inventory/validation";
import { MAX_NAME_LENGTH, MAX_SKU_LENGTH } from "@/lib/products/validation";
import type { InventoryItem } from "./staffApi";

export type ProductFormValues = {
  sku: string;
  name: string;
  categoryId: string;
  description: string;
  imageUrl: string;
  price: string;
  weight: string;
  stock: string;
};

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  sku: "",
  name: "",
  categoryId: "",
  description: "",
  imageUrl: "",
  price: "",
  weight: "",
  stock: "0",
};

const TWO_DECIMALS = /^(\d+)(?:\.(\d{1,2}))?$/;

/** "12.5" -> 1250. Accepts at most two decimal places. */
export function parseHundredths(text: string): number | null {
  const match = TWO_DECIMALS.exec(text.trim().replace(/^\$/, ""));
  if (!match) return null;
  const value = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(value) ? value : null;
}

/** 1250 -> "12.50" (the form's text, without a $ or unit). */
export function formatHundredths(value: number): string {
  return `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

export function formFromItem(item: InventoryItem): ProductFormValues {
  return {
    sku: item.sku,
    name: item.name,
    categoryId: item.categoryId,
    description: item.description,
    imageUrl: item.imageUrl ?? "",
    price: formatHundredths(item.priceCents),
    weight: formatHundredths(item.unitWeight),
    stock: String(item.stockQuantity),
  };
}

type ProductBody = {
  sku: string;
  name: string;
  categoryId: string;
  description: string;
  imageUrl: string | null;
  priceCents: number;
  unitWeight: number;
};

function parseFields(values: ProductFormValues): Parsed<ProductBody> {
  const sku = values.sku.trim();
  const name = values.name.trim();
  if (!sku) return { ok: false, message: "Enter a SKU." };
  if (sku.length > MAX_SKU_LENGTH) return { ok: false, message: `SKU must be at most ${MAX_SKU_LENGTH} characters.` };
  if (!name) return { ok: false, message: "Enter a product name." };
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, message: `Name must be at most ${MAX_NAME_LENGTH} characters.` };
  }
  if (!values.categoryId) return { ok: false, message: "Choose a category." };

  const priceCents = parseHundredths(values.price);
  if (priceCents === null || priceCents > PG_INT_MAX) {
    return { ok: false, message: "Enter a price like 3.99." };
  }
  const unitWeight = parseHundredths(values.weight);
  if (unitWeight === null || unitWeight < 1 || unitWeight > MAX_CART_WEIGHT) {
    return { ok: false, message: `Enter a weight between 0.01 and ${formatHundredths(MAX_CART_WEIGHT)} lb.` };
  }

  return {
    ok: true,
    value: {
      sku,
      name,
      categoryId: values.categoryId,
      description: values.description.trim(),
      imageUrl: values.imageUrl.trim() || null,
      priceCents,
      unitWeight,
    },
  };
}

/** Body for POST /api/admin/products. */
export function toCreateBody(values: ProductFormValues): Parsed<ProductBody & { stockQuantity: number }> {
  const fields = parseFields(values);
  if (!fields.ok) return fields;
  const stock = values.stock.trim();
  if (!/^\d+$/.test(stock) || Number(stock) > PG_INT_MAX) {
    return { ok: false, message: "Starting stock must be a whole number, 0 or more." };
  }
  return { ok: true, value: { ...fields.value, stockQuantity: Number(stock) } };
}

/** Body for PUT /api/admin/products/:id with only the fields that changed. */
export function toChangesBody(values: ProductFormValues, original: InventoryItem): Parsed<Partial<ProductBody>> {
  const fields = parseFields(values);
  if (!fields.ok) return fields;
  const before: ProductBody = {
    sku: original.sku,
    name: original.name,
    categoryId: original.categoryId,
    description: original.description,
    imageUrl: original.imageUrl,
    priceCents: original.priceCents,
    unitWeight: original.unitWeight,
  };
  const changes: Partial<Record<keyof ProductBody, unknown>> = {};
  for (const key of Object.keys(before) as (keyof ProductBody)[]) {
    if (fields.value[key] !== before[key]) changes[key] = fields.value[key];
  }
  if (Object.keys(changes).length === 0) return { ok: false, message: "Nothing changed." };
  return { ok: true, value: changes as Partial<ProductBody> };
}

/** Parses the quantity box on an inventory row. */
export function parseQuantityInput(text: string): Parsed<number> {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return { ok: false, message: "Stock must be a whole number, 0 or more." };
  const quantity = Number(trimmed);
  if (quantity > PG_INT_MAX) return { ok: false, message: "That quantity is too large." };
  return { ok: true, value: quantity };
}

/** The low-stock cutoff. Anything that isn't a usable number falls back to the default. */
export function parseThreshold(text: string): number {
  const parsed = parseQuantityInput(text);
  return parsed.ok ? parsed.value : DEFAULT_LOW_STOCK_THRESHOLD;
}
