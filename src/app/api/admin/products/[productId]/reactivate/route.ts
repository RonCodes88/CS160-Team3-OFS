import type { NextRequest } from "next/server";
import { errorResponse, internalErrorResponse } from "@/lib/api/errors";
import { MANAGER_ROLES, requireRole } from "@/lib/auth/requireRole";
import { isUuid } from "@/lib/inventory/validation";
import { productFailureResponse, reactivateProduct } from "@/lib/products/service";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/admin/products/:productId/reactivate
// Puts a retired product back on sale (is_active = true) and writes an audit
// row. Reactivating an active product is a no-op. MANAGER only.
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/products/[productId]/reactivate">,
) {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, MANAGER_ROLES);
    if (!auth.ok) return auth.response;

    const { productId } = await ctx.params;
    if (!isUuid(productId)) {
      return errorResponse(400, "VALIDATION_ERROR", "productId must be a UUID.");
    }

    const result = await reactivateProduct(db, auth.user.id, productId);
    if (!result.ok) return productFailureResponse(result.reason);
    return Response.json({ product: result.product, changed: result.changed });
  } catch (err) {
    return internalErrorResponse(err);
  }
}
