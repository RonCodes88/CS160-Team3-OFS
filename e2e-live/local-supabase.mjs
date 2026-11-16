// Connection details for the LOCAL Supabase test database. Throws unless the
// database is on this machine, so the live suite can never touch hosted data.
import { execFileSync } from "node:child_process";

export function localSupabase() {
  let values = {};
  if (process.env.SUPABASE_TEST_URL && process.env.SUPABASE_TEST_SECRET_KEY) {
    values = {
      API_URL: process.env.SUPABASE_TEST_URL,
      SECRET_KEY: process.env.SUPABASE_TEST_SECRET_KEY,
      PUBLISHABLE_KEY: process.env.SUPABASE_TEST_PUBLISHABLE_KEY ?? "sb_publishable_local",
    };
  } else {
    const output = execFileSync("npx", ["supabase", "status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of output.split("\n")) {
      const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
      if (match) values[match[1]] = match[2];
    }
  }
  const host = values.API_URL ? new URL(values.API_URL).hostname : "";
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    throw new Error("Live E2E needs a LOCAL Supabase. Run `npx supabase start` first.");
  }
  return {
    url: values.API_URL,
    secretKey: values.SECRET_KEY ?? values.SERVICE_ROLE_KEY,
    publishableKey: values.PUBLISHABLE_KEY ?? values.ANON_KEY,
  };
}
