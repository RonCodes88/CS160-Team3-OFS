import type { NextRequest } from "next/server";
import { errorResponse, internalErrorResponse } from "@/lib/api/errors";
import { createAddress, listAddresses } from "@/lib/auth/addresses";
import { parseAddressInput } from "@/lib/auth/addressValidation";
import { GeocodeError, geocodeAddress } from "@/lib/auth/geocode";
import { readJsonBody } from "@/lib/auth/http";
import { requireRole } from "@/lib/auth/requireRole";
import { isWithinServiceArea, readServiceArea, ServiceAreaUnavailable } from "@/lib/auth/serviceArea";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/addresses
// The session customer's saved addresses, default first. CUSTOMER only.
export async function GET(request: NextRequest) {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, ["CUSTOMER"]);
    if (!auth.ok) return auth.response;

    return Response.json({ addresses: await listAddresses(db, auth.user.id) });
  } catch (err) {
    return internalErrorResponse(err);
  }
}

// POST /api/addresses  { label?, line1, line2?, city, state, postalCode }
// Geocodes with Mapbox and saves the address only if it is inside the service
// area. Coordinates are never accepted from the client. CUSTOMER only.
export async function POST(request: NextRequest) {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, ["CUSTOMER"]);
    if (!auth.ok) return auth.response;

    const json = await readJsonBody(request);
    if (!json.ok) return json.response;
    const parsed = parseAddressInput(json.body);
    if (!parsed.ok) return errorResponse(400, "VALIDATION_ERROR", parsed.message);

    // Read the area first so a missing configuration fails before calling Mapbox.
    const area = readServiceArea();
    const result = await createAddress(db, auth.user.id, parsed.value, {
      geocode: (query) => geocodeAddress(query),
      isDeliverable: (point) => isWithinServiceArea(point, area),
    });
    if (!result.ok) {
      const message = result.reason === "NOT_FOUND"
        ? "We couldn't find that address. Check the street, city, and ZIP code."
        : "That address is outside our Downtown San Jose delivery area.";
      return Response.json({ error: { code: result.reason === "NOT_FOUND" ? "ADDRESS_NOT_FOUND" : "ADDRESS_OUTSIDE_AREA", message } },
        { status: 422 });
    }
    return Response.json({ address: result.address }, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceAreaUnavailable || err instanceof GeocodeError) {
      console.error(err);
      return Response.json({ error: { code: "ADDRESS_LOOKUP_UNAVAILABLE",
        message: "We can't check addresses right now. Please try again later." } }, { status: 503 });
    }
    return internalErrorResponse(err);
  }
}
