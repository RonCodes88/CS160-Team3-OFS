import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function migrationArgs(env) {
  const value = env.OFS_DATABASE_URL?.trim();
  if (!value) throw new Error("OFS_DATABASE_URL is missing. Ask the team for a complete .env.local with the Supabase PostgreSQL connection URL.");
  let url;
  try { url = new URL(value); } catch { throw new Error("OFS_DATABASE_URL must be a PostgreSQL connection URL."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username) {
    throw new Error("OFS_DATABASE_URL must be a PostgreSQL connection URL.");
  }
  // Use Supabase's migration history and transactional application. Never reset
  // the database, repair history automatically, or replay the demo seed.
  return ["db", "push", "--db-url", value, "--yes"];
}

export function migrate({ env = process.env, run = spawnSync, log = console.log } = {}) {
  const args = migrationArgs(env);
  log("Applying pending database migrations before starting OFS...");
  const result = run("./node_modules/.bin/supabase", args, { encoding: "utf8", env, maxBuffer: 10 * 1024 * 1024 });
  const url = new URL(env.OFS_DATABASE_URL.trim());
  const secrets = [env.OFS_DATABASE_URL.trim(), url.password, decodeURIComponent(url.password)].filter(Boolean);
  let output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  for (const secret of secrets) output = output.replaceAll(secret, "[redacted]");
  if (output.trim()) log(output.trim());
  if (result.error || result.status !== 0) {
    throw new Error("Database migrations failed. The app has not started. Check the database connection and migration error above; existing data has not been reset.");
  }
  log("Database migrations complete.");
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  try { migrate(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
