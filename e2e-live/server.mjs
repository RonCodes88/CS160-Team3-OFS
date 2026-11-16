// Starts the real Next.js app against the LOCAL Supabase test database for
// the live end-to-end suite.
import { spawn } from "node:child_process";
import { localSupabase } from "./local-supabase.mjs";

const PORT = process.env.OFS_E2E_PORT ?? "3004";
const supabase = localSupabase();

const child = spawn("npx", ["next", "dev", "--port", PORT], {
  stdio: "inherit",
  env: {
    ...process.env,
    // Real environment variables win over .env.local, so these point the app
    // at the local database whatever .env.local says.
    NEXT_PUBLIC_SUPABASE_URL: supabase.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
    SUPABASE_SECRET_KEY: supabase.secretKey,
    OFS_NEXT_DIST_DIR: ".next-e2e",
    OFS_STORE_LATITUDE: "37.3352",
    OFS_STORE_LONGITUDE: "-121.8811",
    OFS_DELIVERY_RADIUS_METERS: "5000",
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
