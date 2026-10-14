import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { checkDatabaseHealth } from "./health";

function clientReturning(result: unknown) {
  const rpc = vi.fn(async () => result);
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

// Fake clock: 1000 at the start, 1012 at the end.
const clock = () => {
  let t = 1000;
  return () => (t += 12) - 12;
};

describe("checkDatabaseHealth", () => {
  it("reports the database, PostGIS version, and latency", async () => {
    const { db, rpc } = clientReturning({
      data: { database: "postgres", postgis: "3.3.7", checked_at: "2026-10-14T00:00:00Z" },
      error: null,
    });
    expect(await checkDatabaseHealth(db, clock())).toEqual({
      ok: true,
      database: "postgres",
      postgis: "3.3.7",
      latencyMs: 12,
    });
    expect(rpc).toHaveBeenCalledWith("db_health");
  });

  it("says migrations are missing when db_health() doesn't exist", async () => {
    const { db } = clientReturning({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    expect(await checkDatabaseHealth(db)).toMatchObject({ ok: false, reason: "MIGRATIONS_MISSING" });
  });

  it("passes through other query errors", async () => {
    const { db } = clientReturning({ data: null, error: { code: "42501", message: "permission denied" } });
    expect(await checkDatabaseHealth(db)).toEqual({ ok: false, reason: "QUERY_FAILED", message: "permission denied" });
  });

  it("reports a network failure instead of throwing", async () => {
    const db = { rpc: vi.fn().mockRejectedValue(new TypeError("fetch failed")) } as unknown as SupabaseClient;
    expect(await checkDatabaseHealth(db)).toEqual({ ok: false, reason: "QUERY_FAILED", message: "fetch failed" });
  });
});
