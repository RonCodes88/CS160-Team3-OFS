import type { SupabaseClient } from "@supabase/supabase-js";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password";
import type { Role, SessionUser } from "./session";
import type { Credentials } from "./validation";

type UserRow = { id: string; email: string; role: Role; status: string; password_hash: string };

export type RegisterResult = { ok: true; user: SessionUser } | { ok: false; reason: "EMAIL_TAKEN" };

const UNIQUE_VIOLATION = "23505";

/** Creates a CUSTOMER account. Other roles are never created here. */
export async function registerCustomer(
  db: SupabaseClient,
  { email, password }: Credentials,
): Promise<RegisterResult> {
  const { data, error } = await db
    .from("users")
    .insert({ email, password_hash: await hashPassword(password), role: "CUSTOMER" })
    .select("id, email, role")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, reason: "EMAIL_TAKEN" };
    throw new Error(`registerCustomer failed: ${error.message}`);
  }
  return { ok: true, user: data as SessionUser };
}

/**
 * Returns the ACTIVE user for a correct email and password, or null. Unknown
 * emails, wrong passwords, and disabled or locked accounts look the same.
 */
export async function authenticate(
  db: SupabaseClient,
  { email, password }: Credentials,
): Promise<SessionUser | null> {
  const { data, error } = await db
    .from("users")
    .select("id, email, role, status, password_hash")
    // Emails are stored lowercased (normalizeEmail), so an exact match is case-insensitive.
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(`authenticate failed: ${error.message}`);

  const user = data as UserRow | null;
  if (!user) {
    await verifyAgainstDummy(password);
    return null;
  }
  if (!(await verifyPassword(user.password_hash, password)) || user.status !== "ACTIVE") return null;

  const { error: updateError } = await db
    .from("users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", user.id);
  if (updateError) throw new Error(`authenticate failed: ${updateError.message}`);

  return { id: user.id, email: user.email, role: user.role };
}
