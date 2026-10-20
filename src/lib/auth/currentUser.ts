import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUserByToken, SESSION_COOKIE, type SessionUser } from "./session";

/**
 * The signed-in user for Server Components. Signed-out visitors skip the
 * database. A failed lookup is logged and treated as signed out so the page
 * still renders; API routes use requireRole, which fails closed instead.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await getSessionUserByToken(createAdminClient(), token);
  } catch (err) {
    console.error(err);
    return null;
  }
}
