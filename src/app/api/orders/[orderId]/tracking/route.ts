import type { NextRequest } from "next/server";
import { errorResponse, internalErrorResponse } from "@/lib/api/errors";
import { requireRole } from "@/lib/auth/requireRole";
import { isUuid } from "@/lib/inventory/validation";
import { getCustomerTracking } from "@/lib/orders/tracking";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/orders/:orderId/tracking
// Returns tracking information for the signed-in customer's order.
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/orders/[orderId]/tracking">,
) {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, ["CUSTOMER"]);
    if (!auth.ok) return auth.response;

    const { orderId } = await ctx.params;

    if (!isUuid(orderId)) {
      return errorResponse(400, "VALIDATION_ERROR", "orderId must be a UUID.");
    }

    const result = await getCustomerTracking(
      db,
      auth.user.id,
      orderId.toLowerCase(),
    );

    if (!result.ok) {
      if (result.reason === "FORBIDDEN") {
        return errorResponse(403, "FORBIDDEN", "You cannot view this order.");
      }

      return errorResponse(404, "NOT_FOUND", "Order not found.");
    }

    return Response.json(
      { tracking: result.tracking },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return internalErrorResponse(error);
  }
}
