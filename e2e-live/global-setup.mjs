// The suite registers many accounts from one machine. Without a trusted proxy
// every request shares one sign-up budget (30 per 15 minutes), so clear the
// LOCAL database's counters before each run.
import { localSupabase } from "./local-supabase.mjs";

export default async function globalSetup() {
  const { url, secretKey } = localSupabase();
  const response = await fetch(`${url}/rest/v1/auth_rate_limits?scope=not.is.null`, {
    method: "DELETE",
    headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
  });
  if (!response.ok) throw new Error(`Could not reset local auth rate limits: ${response.status}`);
}
