import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { authRateLimit, refundAuthRateLimit } from "./sharedRateLimit";
try { process.loadEnvFile(".env.test.local"); } catch { /* Optional local-only tests. */ }
const url = process.env.SUPABASE_TEST_URL, key = process.env.SUPABASE_TEST_SECRET_KEY;
if (url && !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?\/?$/.test(url)) throw new Error("Local database required");
describe.skipIf(!url || !key)("shared auth rate limits", () => {
  it("shares counters across clients, atomically limits concurrent requests, and refunds success", async () => {
    const a = createClient(url!, key!, { auth: { persistSession: false } });
    const b = createClient(url!, key!, { auth: { persistSession: false } });
    const identity = randomUUID();
    try {
      const results = await Promise.all(Array.from({ length: 35 }, (_, i) => authRateLimit(i % 2 ? a : b, "login-ip", identity)));
      expect(results.filter(r => r.ok)).toHaveLength(30);
      expect(results.filter(r => !r.ok)).toHaveLength(5);
      await refundAuthRateLimit(a, "login-ip", identity);
      expect((await authRateLimit(b, "login-ip", identity)).ok).toBe(true);
      expect((await authRateLimit(a, "login-ip", identity)).ok).toBe(false);
    } finally {
      await a.from("auth_rate_limits").delete().eq("key_hash", (await import("node:crypto")).createHash("sha256").update(identity).digest("hex"));
    }
  });
});
