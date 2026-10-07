import type { NextRequest } from "next/server";
import { errorResponse, internalErrorResponse } from "@/lib/api/errors";
import { requireRole, STAFF_ROLES } from "@/lib/auth/requireRole";
import { listLowStock } from "@/lib/inventory/service";
import { parseLowStockQuery } from "@/lib/inventory/validation";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/staff/inventory/low-stock?threshold=&limit=&offset=
// Active products with stock_quantity <= threshold (default 10), lowest first.
// EMPLOYEE or MANAGER only.
export async function GET(request: NextRequest) {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, STAFF_ROLES);
    if (!auth.ok) return auth.response;

    const query = parseLowStockQuery(request.nextUrl.searchParams);
    if (!query.ok) return errorResponse(400, "VALIDATION_ERROR", query.message);

    const page = await listLowStock(db, query.value);
    return Response.json({ ...page, ...query.value });
  } catch (err) {
    return internalErrorResponse(err);
  }
}
