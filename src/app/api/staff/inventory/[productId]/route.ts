import type { NextRequest } from "next/server";
import { errorResponse, internalErrorResponse } from "@/lib/api/errors";
import { requireRole, STAFF_ROLES } from "@/lib/auth/requireRole";
import { setInventoryQuantity } from "@/lib/inventory/service";
import { isUuid, parseExpectedQuantity, parseQuantityBody } from "@/lib/inventory/validation";
import { createAdminClient } from "@/lib/supabase/admin";

// PUT /api/staff/inventory/:productId   body: { "quantity": 12, "expectedQuantity"?: 10 }
// With expectedQuantity, the change is refused with 409 if the stock is no
// longer that value (another tab or a checkout changed it).
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
    const expected = parseExpectedQuantity(body);
    if (!expected.ok) return errorResponse(400, "VALIDATION_ERROR", expected.message);

    // The actor is always the session user, never a value from the body.
    const result = await setInventoryQuantity(db, auth.user.id, productId, quantity.value, expected.value);
    if (!result.ok) {
      switch (result.reason) {
        case "NOT_FOUND":
          return errorResponse(404, "NOT_FOUND", "Product not found.");
        case "INVALID_QUANTITY":
          return errorResponse(400, "VALIDATION_ERROR", "quantity cannot be negative.");
        case "FORBIDDEN":
          return errorResponse(403, "FORBIDDEN", "You do not have access to this resource.");
        case "STALE":
          return Response.json({
            error: {
              code: "CONFLICT",
              message: result.currentQuantity === null
                ? "The stock changed since you loaded it. Reload and try again."
                : `The stock changed to ${result.currentQuantity} since you loaded it. Check the new count and save again.`,
            },
            currentQuantity: result.currentQuantity,
          }, { status: 409 });
      }
    }
    return Response.json(result.value);
  } catch (err) {
    return internalErrorResponse(err);
  }
}
