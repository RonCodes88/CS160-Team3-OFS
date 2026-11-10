import type { NextRequest } from "next/server";
import { errorResponse, internalErrorResponse } from "@/lib/api/errors";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseVehicleLocationBody } from "@/lib/vehicle/locationValidation";
import { updateVehicleLocation } from "@/lib/vehicle/locationService";

// PATCH /api/vehicle/location
// Updates the signed-in vehicle's location and battery level. VEHICLE only.
export async function PATCH(request: NextRequest) {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, ["VEHICLE"]);
    if (!auth.ok) return auth.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, "VALIDATION_ERROR", "Body must be valid JSON.");
    }

    const input = parseVehicleLocationBody(body);
    if (!input.ok) {
      return errorResponse(400, "VALIDATION_ERROR", input.message);
    }

    const location = await updateVehicleLocation(db, auth.user.id, input.value);
    if (!location) {
      return errorResponse(404, "NOT_FOUND", "Vehicle not found.");
    }

    return Response.json(
      { location },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return internalErrorResponse(error);
  }
}
