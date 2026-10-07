import type { NextRequest } from "next/server";
import { errorResponse, internalErrorResponse } from "@/lib/api/errors";
import { requireRole, STAFF_ROLES } from "@/lib/auth/requireRole";
import { setInventoryQuantity } from "@/lib/inventory/service";
import { isUuid, parseQuantityBody } from "@/lib/inventory/validation";
import { createAdminClient } from "@/lib/supabase/admin";

// PUT /api/staff/inventory/:productId   body: { "quantity": 12 }
// Sets the product's stock and writes an audit_log row in one transaction.
// Setting the current value again is a no-op (no audit row). EMPLOYEE or MANAGER only.
export async function PUT(
  request: NextRequest,
  ctx: RouteContext<"/api/staff/inventory/[productId]">,
) {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, STAFF_ROLES);
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
    const quantity = parseQuantityBody(body);
    if (!quantity.ok) return errorResponse(400, "VALIDATION_ERROR", quantity.message);

    // The actor is always the session user, never a value from the body.
    const result = await setInventoryQuantity(db, auth.user.id, productId, quantity.value);
    if (!result.ok) {
      switch (result.reason) {
        case "NOT_FOUND":
          return errorResponse(404, "NOT_FOUND", "Product not found.");
        case "INVALID_QUANTITY":
          return errorResponse(400, "VALIDATION_ERROR", "quantity cannot be negative.");
        case "FORBIDDEN":
          return errorResponse(403, "FORBIDDEN", "You do not have access to this resource.");
      }
    }
    return Response.json(result.value);
  } catch (err) {
    return internalErrorResponse(err);
  }
}
