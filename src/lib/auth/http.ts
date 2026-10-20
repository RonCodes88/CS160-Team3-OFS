import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/errors";
import { SESSION_COOKIE, sessionCookieOptions, type SessionUser } from "./session";

type JsonBody = { ok: true; body: unknown } | { ok: false; response: Response };

/**
 * Reads a JSON body. Requiring the JSON content type also blocks cross-site
 * HTML form posts, which can't send it without a CORS preflight.
 */
export async function readJsonBody(request: Request): Promise<JsonBody> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return { ok: false, response: errorResponse(415, "VALIDATION_ERROR", "Send the request as JSON.") };
  }
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: errorResponse(400, "VALIDATION_ERROR", "The request body is not valid JSON.") };
  }
}

/** The public view of a user. Password and session hashes are never included. */
export function publicUser({ id, email, role }: SessionUser) {
  return { id, email, role };
}

/** Responds with the user and sets the session cookie. */
export function signedInResponse(
  user: SessionUser,
  session: { token: string; expiresAt: Date },
  status: number,
): NextResponse {
  const response = NextResponse.json({ user: publicUser(user) }, { status });
  response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return response;
}

export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return errorResponse(429, "RATE_LIMITED", "Too many attempts. Try again later.", {
    "Retry-After": String(retryAfterSeconds),
  });
}
