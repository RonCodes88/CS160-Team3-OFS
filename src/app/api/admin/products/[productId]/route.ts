import type { NextRequest } from "next/server";
import { errorResponse, internalErrorResponse } from "@/lib/api/errors";
import { MANAGER_ROLES, requireRole } from "@/lib/auth/requireRole";
import { isUuid } from "@/lib/inventory/validation";
import { productFailureResponse, retireProduct, updateProduct } from "@/lib/products/service";
import { parseProductChanges } from "@/lib/products/validation";
import { createAdminClient } from "@/lib/supabase/admin";

type Context = RouteContext<"/api/admin/products/[productId]">;

// PUT /api/admin/products/:productId
// body: any of { sku, categoryId, name, description, imageUrl, priceCents, unitWeight }
// Only fields that actually change are written and audited (PRODUCT_UPDATE). MANAGER only.
export async function PUT(request: NextRequest, ctx: Context) {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, MANAGER_ROLES);
    if (!auth.ok) return auth.response;

    const { productId } = await ctx.params;
    if (!isUuid(productId)) {
      return errorResponse(400, "VALIDATION_ERROR", "productId must be a UUID.");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "VALIDATION_ERROR", "Body must be valid JSON.");
    }
    const changes = parseProductChanges(body);
    if (!changes.ok) return errorResponse(400, "VALIDATION_ERROR", changes.message);

    const result = await updateProduct(db, auth.user.id, productId, changes.value);
    if (!result.ok) return productFailureResponse(result.reason);
    return Response.json({ product: result.product, changed: result.changed });
  } catch (err) {
    return internalErrorResponse(err);
  }
}

// DELETE /api/admin/products/:productId
// Retires the product (is_active = false); the row is never deleted, so past
// orders keep valid product IDs. Retiring twice is a no-op. MANAGER only.
export async function DELETE(request: NextRequest, ctx: Context) {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, MANAGER_ROLES);
    if (!auth.ok) return auth.response;

    const { productId } = await ctx.params;
    if (!isUuid(productId)) {
      return errorResponse(400, "VALIDATION_ERROR", "productId must be a UUID.");
    }

    const result = await retireProduct(db, auth.user.id, productId);
    if (!result.ok) return productFailureResponse(result.reason);
    return Response.json({ product: result.product, changed: result.changed });
  } catch (err) {
    return internalErrorResponse(err);
  }
}
