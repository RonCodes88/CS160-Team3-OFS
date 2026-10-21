import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid, parsePage, type Parsed } from "@/lib/inventory/validation";

// Read side of audit_log for managers. Rows are written only by the
// staff_* and admin_* database functions, never directly by API code.

export const AUDIT_ACTIONS = [
  "INVENTORY_SET_QUANTITY",
  "PRODUCT_CREATE",
  "PRODUCT_UPDATE",
  "PRODUCT_RETIRE",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditLogQuery = {
  productId: string | null;
  action: AuditAction | null;
  limit: number;
  offset: number;
};

export type AuditEntry = {
  id: string;
  action: AuditAction;
  productId: string;
  productSku: string | null;
  productName: string | null;
  actorUserId: string;
  actorEmail: string | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
};

type AuditRow = {
  id: string;
  action: AuditAction;
  product_id: string;
  actor_user_id: string;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
  actor: { email: string } | null;
  product: { sku: string; name: string } | null;
};

/** `?productId=&action=&limit=&offset=` for GET /api/admin/audit-log. */
export function parseAuditLogQuery(params: URLSearchParams): Parsed<AuditLogQuery> {
  const productId = params.get("productId") || null;
  if (productId !== null && !isUuid(productId)) {
    return { ok: false, message: "productId must be a UUID." };
  }
  const action = params.get("action") || null;
  if (action !== null && !(AUDIT_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, message: `action must be one of ${AUDIT_ACTIONS.join(", ")}.` };
  }
  const page = parsePage(params);
  if (!page.ok) return page;
  return {
    ok: true,
    value: {
      productId: productId?.toLowerCase() ?? null,
      action: action as AuditAction | null,
      ...page.value,
    },
  };
}

/** Newest entries first, with the actor's email and the product's SKU and name. */
export async function listAuditLog(
  db: SupabaseClient,
  { productId, action, limit, offset }: AuditLogQuery,
): Promise<{ entries: AuditEntry[]; hasMore: boolean }> {
  let query = db
    .from("audit_log")
    .select(
      "id, action, product_id, actor_user_id, old_value, new_value, created_at, actor:users(email), product:products(sku, name)",
    );
  if (productId) query = query.eq("product_id", productId);
  if (action) query = query.eq("action", action);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit);
  if (error) throw new Error(`listAuditLog failed: ${error.message}`);

  // One extra row was fetched to learn whether another page exists.
  const rows = data as unknown as AuditRow[];
  return {
    entries: rows.slice(0, limit).map((row) => ({
      id: row.id,
      action: row.action,
      productId: row.product_id,
      productSku: row.product?.sku ?? null,
      productName: row.product?.name ?? null,
      actorUserId: row.actor_user_id,
      actorEmail: row.actor?.email ?? null,
      oldValue: row.old_value,
      newValue: row.new_value,
      createdAt: row.created_at,
    })),
    hasMore: rows.length > limit,
  };
}
