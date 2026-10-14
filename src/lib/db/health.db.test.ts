import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { checkDatabaseHealth } from "./health";

// Runs against a LOCAL Supabase with the migrations applied.
// Setup: `npx supabase start`, then put SUPABASE_TEST_URL and
// SUPABASE_TEST_SECRET_KEY in .env.test.local. Skipped when not configured.
try {
  process.loadEnvFile(".env.test.local");
} catch {
  // Optional file.
}

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_KEY = process.env.SUPABASE_TEST_SECRET_KEY;

// host.docker.internal is the developer's own machine when tests run in Docker.
if (
  TEST_URL &&
  !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(TEST_URL)
) {
  throw new Error(`Refusing to run DB tests against non-local SUPABASE_TEST_URL: ${TEST_URL}`);
}

describe.skipIf(!TEST_URL || !TEST_KEY)("database health against Postgres", () => {
  it("connects with the secret key and finds PostGIS", async () => {
    const db = createClient(TEST_URL!, TEST_KEY!, { auth: { persistSession: false } });
    const health = await checkDatabaseHealth(db);
    expect(health).toMatchObject({ ok: true, database: "postgres" });
    expect(health.ok && health.postgis).toMatch(/^\d+\.\d+/);
  });
});
