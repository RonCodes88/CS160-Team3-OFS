import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/api/errors";
import { getSessionUser, type Role, type SessionUser } from "@/lib/auth/session";

export const STAFF_ROLES: readonly Role[] = ["EMPLOYEE", "MANAGER"];

type AuthResult = { ok: true; user: SessionUser } | { ok: false; response: Response };

/** 401 without a valid session, 403 when the user's role is not allowed. */
export async function requireRole(
  request: NextRequest,
  db: SupabaseClient,
  allowed: readonly Role[],
): Promise<AuthResult> {
  const user = await getSessionUser(request, db);
  if (!user) {
    return { ok: false, response: errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.") };
  }
  if (!allowed.includes(user.role)) {
    return {
      ok: false,
      response: errorResponse(403, "FORBIDDEN", "You do not have access to this resource."),
    };
  }
  return { ok: true, user };
}
