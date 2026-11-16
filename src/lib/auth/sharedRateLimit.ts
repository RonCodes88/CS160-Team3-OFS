import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RateLimitResult } from "./rateLimit";

export type AuthLimitScope = "register-ip" | "login-ip" | "login-pair" | "login-account";
const keyHash = (key: string) => createHash("sha256").update(key).digest("hex");

/** Counters live in PostgreSQL, shared by every app replica. Identity stays hashed. */
export async function authRateLimit(db: SupabaseClient, scope: AuthLimitScope, key: string): Promise<RateLimitResult> {
  const { data, error } = await db.rpc("auth_consume_rate_limit", { p_scope: scope, p_key_hash: keyHash(key) });
  if (error) throw new Error("Authentication rate limiting is unavailable.");
  if (!data || typeof data.ok !== "boolean") throw new Error("Invalid auth rate limit response.");
  return data.ok ? { ok: true } : { ok: false, retryAfterSeconds: data.retryAfterSeconds };
}

export async function refundAuthRateLimit(db: SupabaseClient, scope: AuthLimitScope, key: string): Promise<void> {
  const { error } = await db.rpc("auth_refund_rate_limit", { p_scope: scope, p_key_hash: keyHash(key) });
  if (error) throw new Error("Authentication rate limit refund is unavailable.");
}
