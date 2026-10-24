import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts", "src/**/types.ts"],
      reporter: ["text-summary", "text", "html"],
      thresholds: {
        // Global floor a few points under coverage measured without a database
        // (how CI's check job runs). Raise it as coverage grows; never lower it.
        statements: 65,
        branches: 65,
        functions: 55,
        lines: 65,
        // Fee and capacity rules must stay fully covered (AGENTS.md).
        "src/lib/cart/pricing.ts": { 100: true },
        "src/lib/delivery/batching.ts": { 100: true },
      },
    },
  },
});
