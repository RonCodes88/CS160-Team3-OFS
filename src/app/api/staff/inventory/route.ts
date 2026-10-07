import type { NextRequest } from "next/server";
import { errorResponse, internalErrorResponse } from "@/lib/api/errors";
import { requireRole, STAFF_ROLES } from "@/lib/auth/requireRole";
import { listInventory } from "@/lib/inventory/service";
import { parseInventoryQuery } from "@/lib/inventory/validation";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/staff/inventory?q=&limit=&offset=
// Lists active products and their stock. Search matches name or SKU.
// EMPLOYEE or MANAGER only.
export async function GET(request: NextRequest) {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, STAFF_ROLES);
    if (!auth.ok) return auth.response;

    const query = parseInventoryQuery(request.nextUrl.searchParams);
    if (!query.ok) return errorResponse(400, "VALIDATION_ERROR", query.message);

    const page = await listInventory(db, query.value);
    return Response.json({ ...page, limit: query.value.limit, offset: query.value.offset });
  } catch (err) {
    return internalErrorResponse(err);
  }
}
