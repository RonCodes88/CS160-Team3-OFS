import type { SupabaseClient } from "@supabase/supabase-js";

// Runs public.db_health() (see supabase/migrations/*_postgis_and_db_health.sql).
// Needs the secret-key client from createAdminClient: the function is not
// callable with the publishable key.

export type DbHealth =
  | { ok: true; database: string; postgis: string; latencyMs: number }
  | { ok: false; reason: "MIGRATIONS_MISSING" | "QUERY_FAILED"; message: string };

type HealthRow = { database: string; postgis: string; checked_at: string };

/** PostgREST's code for "function not found in the schema cache". */
const FUNCTION_NOT_FOUND = "PGRST202";

export async function checkDatabaseHealth(db: SupabaseClient, now: () => number = Date.now): Promise<DbHealth> {
  const started = now();
  try {
    const { data, error } = await db.rpc("db_health");
    if (error) {
      return error.code === FUNCTION_NOT_FOUND
        ? {
            ok: false,
            reason: "MIGRATIONS_MISSING",
            message: "Connected, but db_health() is missing. Apply the migrations in supabase/migrations.",
          }
        : { ok: false, reason: "QUERY_FAILED", message: error.message };
    }
    const row = data as HealthRow;
    return { ok: true, database: row.database, postgis: row.postgis, latencyMs: now() - started };
  } catch (e) {
    return { ok: false, reason: "QUERY_FAILED", message: e instanceof Error ? e.message : String(e) };
  }
}
