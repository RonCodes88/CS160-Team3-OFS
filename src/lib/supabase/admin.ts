import { createClient } from "@supabase/supabase-js";

// Privileged Supabase client for Route Handlers. It bypasses row-level
// security, so callers must check the session and role before using it.
// SUPABASE_SECRET_KEY has no NEXT_PUBLIC_ prefix, so it never reaches the browser.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
