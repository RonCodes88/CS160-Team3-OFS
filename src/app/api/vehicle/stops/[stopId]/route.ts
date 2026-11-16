import type { NextRequest } from "next/server";
import { errorResponse, internalErrorResponse } from "@/lib/api/errors";
import { requireRole } from "@/lib/auth/requireRole";
import { isUuid } from "@/lib/inventory/validation";
import { sendNotificationsAfterResponse } from "@/lib/notifications/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateDeliveryStopStatus } from "@/lib/vehicle/stopStatusService";

// PATCH /api/vehicle/stops/:stopId
// Updates a stop assigned to the signed-in vehicle. VEHICLE only.
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/vehicle/stops/[stopId]">,
) {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, ["VEHICLE"]);
    if (!auth.ok) return auth.response;

    const { stopId } = await ctx.params;
    if (!isUuid(stopId)) {
      return errorResponse(400, "VALIDATION_ERROR", "stopId must be a UUID.");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "VALIDATION_ERROR", "Body must be valid JSON.");
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse(400, "VALIDATION_ERROR", "Body must be an object.");
    }

    const status = (body as Record<string, unknown>).status;
    if (status !== "ARRIVED" && status !== "DELIVERED") {
      return errorResponse(400, "VALIDATION_ERROR", "status must be ARRIVED or DELIVERED.");
    }

    const result = await updateDeliveryStopStatus(
      db,
      auth.user.id,
      stopId,
      status,
    );

    if (!result.ok) {
      if (result.reason === "NOT_FOUND") {
        return errorResponse(404, "NOT_FOUND", "Delivery stop not found.");
      }

      return errorResponse(409, "CONFLICT", "Invalid stop status transition.");
    }

    // The update queued an "arrived" or "delivered" message. Send it now
    // instead of waiting for the recovery worker's next tick.
    sendNotificationsAfterResponse();

    return Response.json(
      { stop: result.stop, tripCompleted: result.tripCompleted },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return internalErrorResponse(error);
  }
}
