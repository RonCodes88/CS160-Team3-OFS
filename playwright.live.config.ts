import { defineConfig } from "@playwright/test";

// Live end-to-end suite: a real browser and real HTTP calls against the real
// app and the LOCAL Supabase test database (no mocked API responses).
// Run with `npm run test:e2e:live` after `npx supabase start`.
const port = process.env.OFS_E2E_PORT ?? "3004";

export default defineConfig({
  testDir: "./e2e-live",
  globalSetup: "./e2e-live/global-setup.mjs",
  // The specs share one database, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  reporter: "list",
  outputDir: "./test-results/live",
  webServer: {
    command: "node e2e-live/server.mjs",
    url: `http://localhost:${port}/api/categories`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
