import type { NextRequest } from "next/server";
import { errorResponse, internalErrorResponse } from "@/lib/api/errors";
import { publicUser } from "@/lib/auth/http";
import { getSessionUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/auth/me
// The signed-in user, or 401.
export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser(request, createAdminClient());
    if (!user) return errorResponse(401, "UNAUTHENTICATED", "Sign in to continue.");
    return Response.json({ user: publicUser(user) });
  } catch (err) {
    return internalErrorResponse(err);
  }
}
