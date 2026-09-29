import { connection } from "next/server";

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

export default async function Home() {
  // Check the connection at request time, not at build time.
  await connection();
  const status = await getSupabaseStatus();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold">CS160 Team 3 — OFS</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Supabase: <span className="font-mono">{status}</span>
      </p>
    </main>
  );
}
