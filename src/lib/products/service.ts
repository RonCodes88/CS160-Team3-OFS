import type { SupabaseClient } from "@supabase/supabase-js";
import { errorResponse } from "@/lib/api/errors";
import type { NewProduct, ProductChanges } from "@/lib/products/validation";

// Manager product changes. Each call runs one admin_* database function that
// changes products and writes audit_log in the same transaction.

export type Product = {
  id: string;
  sku: string;
  categoryId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  priceCents: number;
  unitWeight: number;
  stockQuantity: number;
  isActive: boolean;
  updatedAt: string;
};

type ProductRow = {
  id: string;
  sku: string;
  category_id: string;
  name: string;
  description: string;
  image_url: string | null;
  price_cents: number;
  unit_weight: number;
  stock_quantity: number;
  is_active: boolean;
  updated_at: string;
};

export type ProductFailure = "NOT_FOUND" | "FORBIDDEN" | "DUPLICATE_SKU" | "UNKNOWN_CATEGORY" | "INVALID";

export type ProductResult =
  | { ok: true; product: Product; changed: boolean }
  | { ok: false; reason: ProductFailure };

export function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    sku: row.sku,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    priceCents: row.price_cents,
    unitWeight: row.unit_weight,
    stockQuantity: row.stock_quantity,
    isActive: row.is_active,
    updatedAt: row.updated_at,
  };
}

const FAILURES: Record<string, ProductFailure> = {
  P0002: "NOT_FOUND",
  "42501": "FORBIDDEN",
  "23505": "DUPLICATE_SKU",
  "23503": "UNKNOWN_CATEGORY",
  "22023": "INVALID",
  "22P02": "INVALID",
  "23514": "INVALID",
};

async function callProductFunction(
  db: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; reason: ProductFailure }> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    const reason = error.code ? FAILURES[error.code] : undefined;
    if (reason) return { ok: false, reason };
    throw new Error(`${fn} failed: ${error.message}`);
  }
  return { ok: true, data };
}

type ChangeRow = { changed: boolean; product: ProductRow };

export async function createProduct(
  db: SupabaseClient,
  actorUserId: string,
  product: NewProduct,
): Promise<ProductResult> {
  const result = await callProductFunction(db, "admin_create_product", {
    p_actor_user_id: actorUserId,
    p_product: product,
  });
  if (!result.ok) return result;
  return { ok: true, product: toProduct(result.data as ProductRow), changed: true };
}

/** Only fields whose value differs are written and audited. */
export async function updateProduct(
  db: SupabaseClient,
  actorUserId: string,
  productId: string,
  changes: ProductChanges,
): Promise<ProductResult> {
  const result = await callProductFunction(db, "admin_update_product", {
    p_actor_user_id: actorUserId,
    p_product_id: productId,
    p_changes: changes,
  });
  if (!result.ok) return result;
  const row = result.data as ChangeRow;
  return { ok: true, product: toProduct(row.product), changed: row.changed };
}

/** Sets is_active = false. The row is never deleted. */
export async function retireProduct(
  db: SupabaseClient,
  actorUserId: string,
  productId: string,
): Promise<ProductResult> {
  const result = await callProductFunction(db, "admin_retire_product", {
    p_actor_user_id: actorUserId,
    p_product_id: productId,
  });
  if (!result.ok) return result;
  const row = result.data as ChangeRow;
  return { ok: true, product: toProduct(row.product), changed: row.changed };
}

/** Maps a failed product change to the API's error response. */
export function productFailureResponse(reason: ProductFailure): Response {
  switch (reason) {
    case "NOT_FOUND":
      return errorResponse(404, "NOT_FOUND", "Product not found.");
    case "FORBIDDEN":
      return errorResponse(403, "FORBIDDEN", "You do not have access to this resource.");
    case "DUPLICATE_SKU":
      return errorResponse(409, "CONFLICT", "Another product already uses this SKU.");
    case "UNKNOWN_CATEGORY":
      return errorResponse(400, "VALIDATION_ERROR", "categoryId does not match a category.");
    case "INVALID":
      return errorResponse(400, "VALIDATION_ERROR", "The product data is not valid.");
  }
}
