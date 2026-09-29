import { connection } from "next/server";
import type { ReactNode } from "react";

async function getSupabaseStatus() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return "Not configured — copy .env.example to .env.local";

  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
      cache: "no-store",
    });
    return res.ok ? "Connected" : `Error (HTTP ${res.status})`;
  } catch {
    return `Unreachable at ${url}`;
  }
}

/** Dev-facing Supabase health indicator shown in the footer. */
export async function SupabaseBadge() {
  // Check the connection at request time, not at build time.
  await connection();
  const status = await getSupabaseStatus();
  const ok = status === "Connected";

  return <BadgeShell ok={ok}>Supabase: {status}</BadgeShell>;
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
