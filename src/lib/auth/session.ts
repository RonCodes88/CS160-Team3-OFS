import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

// Sessions live in auth_sessions. The browser holds a random token in an
// httpOnly cookie; only its SHA-256 hash is stored (see AGENTS.md).
export const SESSION_COOKIE = "ofs_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type Role = "CUSTOMER" | "EMPLOYEE" | "MANAGER" | "VEHICLE";

export type SessionUser = { id: string; email: string; role: Role };

type SessionRow = { user: { id: string; email: string; role: Role; status: string } | null };

/** Only token hashes are stored, never the raw token. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Returns the ACTIVE user for a session token, or null for a missing, expired, or revoked session. */
export async function getSessionUserByToken(
  db: SupabaseClient,
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;

  const { data, error } = await db
    .from("auth_sessions")
    .select("user:users!inner(id, email, role, status)")
    .eq("token_hash", hashSessionToken(token))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(`Session lookup failed: ${error.message}`);

  const user = (data as SessionRow | null)?.user;
  if (!user || user.status !== "ACTIVE") return null;
  return { id: user.id, email: user.email, role: user.role };
}

/** Returns the signed-in ACTIVE user, or null for a missing, expired, or revoked session. */
export async function getSessionUser(
  request: NextRequest,
  db: SupabaseClient,
): Promise<SessionUser | null> {
  return getSessionUserByToken(db, request.cookies.get(SESSION_COOKIE)?.value);
}

/** Starts a session and returns the raw token for the cookie. */
export async function createSession(
  db: SupabaseClient,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const { error } = await db.from("auth_sessions").insert({
    user_id: userId,
    token_hash: hashSessionToken(token),
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw new Error(`createSession failed: ${error.message}`);
  return { token, expiresAt };
}

/** Revokes the session for a token. Unknown or already revoked tokens are a no-op. */
export async function revokeSession(db: SupabaseClient, token: string): Promise<void> {
  const { error } = await db
    .from("auth_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", hashSessionToken(token))
    .is("revoked_at", null);
  if (error) throw new Error(`revokeSession failed: ${error.message}`);
}

type CookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  expires: Date;
};

/** httpOnly so scripts can't read it; Secure outside local development. */
export function sessionCookieOptions(expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  };
}
