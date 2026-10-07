import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

// Minimal session lookup against users + auth_sessions (see AGENTS.md).
// The Auth owner can replace the internals; routes only depend on
// getSessionUser's signature. Rename the cookie here if login uses another.
export const SESSION_COOKIE = "ofs_session";

export type Role = "CUSTOMER" | "EMPLOYEE" | "MANAGER" | "VEHICLE";

export type SessionUser = { id: string; role: Role };

type SessionRow = { user: { id: string; role: Role; status: string } | null };

/** Only token hashes are stored, never the raw token. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Returns the signed-in ACTIVE user, or null for a missing, expired, or revoked session. */
export async function getSessionUser(
  request: NextRequest,
  db: SupabaseClient,
): Promise<SessionUser | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const { data, error } = await db
    .from("auth_sessions")
    .select("user:users!inner(id, role, status)")
    .eq("token_hash", hashSessionToken(token))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(`Session lookup failed: ${error.message}`);

  const user = (data as SessionRow | null)?.user;
  if (!user || user.status !== "ACTIVE") return null;
  return { id: user.id, role: user.role };
}
