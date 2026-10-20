import { NextResponse, type NextRequest } from "next/server";
import { internalErrorResponse } from "@/lib/api/errors";
import { revokeSession, SESSION_COOKIE } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/auth/logout
// Revokes the current session and clears the cookie. Safe to call when
// already signed out.
export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (token) await revokeSession(createAdminClient(), token);

    const response = NextResponse.json({ ok: true });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  } catch (err) {
    return internalErrorResponse(err);
  }
}
