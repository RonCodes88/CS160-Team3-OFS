import type { NextRequest } from "next/server";
import { errorResponse, internalErrorResponse } from "@/lib/api/errors";
import { listAuditLog, parseAuditLogQuery } from "@/lib/audit/log";
import { MANAGER_ROLES, requireRole } from "@/lib/auth/requireRole";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/admin/audit-log?productId=&action=&limit=&offset=
// Inventory and product changes, newest first. MANAGER only.
export async function GET(request: NextRequest) {
  try {
    const db = createAdminClient();
    const auth = await requireRole(request, db, MANAGER_ROLES);
    if (!auth.ok) return auth.response;

    const query = parseAuditLogQuery(request.nextUrl.searchParams);
    if (!query.ok) return errorResponse(400, "VALIDATION_ERROR", query.message);

    const page = await listAuditLog(db, query.value);
    return Response.json({ ...page, limit: query.value.limit, offset: query.value.offset });
  } catch (err) {
    return internalErrorResponse(err);
  }
}
