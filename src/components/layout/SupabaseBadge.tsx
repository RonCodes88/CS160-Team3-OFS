import { connection } from "next/server";
import type { ReactNode } from "react";
import { checkDatabaseHealth } from "@/lib/db/health";
import { createAdminClient } from "@/lib/supabase/admin";

async function getSupabaseStatus(): Promise<{ ok: boolean; text: string }> {
  const missing = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    return { ok: false, text: `Not configured — set ${missing.join(" and ")} in .env.local` };
  }

  // Runs a real query through the server's secret-key client.
  const health = await checkDatabaseHealth(createAdminClient());
  return health.ok
    ? { ok: true, text: `Connected · PostGIS ${health.postgis}` }
    : { ok: false, text: health.message };
}

/** Dev-facing database health indicator shown in the footer. */
export async function SupabaseBadge() {
  // Check the connection at request time, not at build time.
  await connection();
  const { ok, text } = await getSupabaseStatus();

  return <BadgeShell ok={ok}>Supabase: {text}</BadgeShell>;
}

export function BadgeShell({ ok, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-wobbly border-2 border-dashed border-pencil bg-white px-3 py-1 text-sm">
      <span
        aria-hidden
        className={`h-2.5 w-2.5 rounded-full border border-pencil ${
          ok === undefined ? "bg-muted" : ok ? "bg-green-500" : "bg-marker"
        }`}
      />
      {children}
    </span>
  );
}
