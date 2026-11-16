import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: { baseURL: "http://localhost:3001", trace: "retain-on-failure" },
  reporter: "list",
  outputDir: "./test-results",
  webServer: [{
    command: "npm run dev -- --port 3001",
    url: "http://localhost:3001/cart",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  }, {
    command: "node e2e/harness/server.mjs",
    url: "http://localhost:3002",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  }],
});
