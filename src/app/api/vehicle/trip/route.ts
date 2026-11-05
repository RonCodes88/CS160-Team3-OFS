import type { NextRequest } from "next/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAssignedTripForVehicle } from "@/lib/vehicle/assignedTrip";

// GET /api/vehicle/trip
// Returns the signed-in vehicle's assigned trip and ordered stops. VEHICLE only.
export async function GET(request: NextRequest) {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, ["VEHICLE"]);
    if (!auth.ok) return auth.response;

    const trip = await getAssignedTripForVehicle(db, auth.user.id);

    return Response.json(
      { trip },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return internalErrorResponse(error);
  }
}
