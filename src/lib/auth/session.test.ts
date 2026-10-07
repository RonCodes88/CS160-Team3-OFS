import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { getSessionUser, hashSessionToken, SESSION_COOKIE } from "@/lib/auth/session";

// Minimal stand-in for the Supabase query builder chain used by getSessionUser.
function fakeDb(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    gt: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
  };
  const from = vi.fn(() => builder);
  return { db: { from } as unknown as SupabaseClient, from, builder };
}

function requestWithToken(token?: string) {
  const headers = new Headers();
  if (token) headers.set("cookie", `${SESSION_COOKIE}=${token}`);
  return new NextRequest("http://localhost/api/staff/inventory", { headers });
}

describe("hashSessionToken", () => {
  it("is the SHA-256 hex digest of the token", () => {
    const expected = createHash("sha256").update("abc").digest("hex");
    expect(hashSessionToken("abc")).toBe(expected);
  });
});

describe("getSessionUser", () => {
  it("returns null without querying when there is no cookie", async () => {
    const { db, from } = fakeDb({ data: null, error: null });
    expect(await getSessionUser(requestWithToken(), db)).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("looks up the hashed token and ignores revoked or expired sessions", async () => {
    const { db, from, builder } = fakeDb({ data: null, error: null });
    await getSessionUser(requestWithToken("raw-token"), db);

    expect(from).toHaveBeenCalledWith("auth_sessions");
    expect(builder.eq).toHaveBeenCalledWith("token_hash", hashSessionToken("raw-token"));
    expect(builder.eq).not.toHaveBeenCalledWith("token_hash", "raw-token");
    expect(builder.is).toHaveBeenCalledWith("revoked_at", null);
    expect(builder.gt).toHaveBeenCalledWith("expires_at", expect.any(String));
  });

  it("returns the user id and role for an active user", async () => {
    const { db } = fakeDb({
      data: { user: { id: "u1", role: "EMPLOYEE", status: "ACTIVE" } },
      error: null,
    });
    expect(await getSessionUser(requestWithToken("t"), db)).toEqual({ id: "u1", role: "EMPLOYEE" });
  });

  it.each(["DISABLED", "LOCKED"])("returns null for a %s user", async (status) => {
    const { db } = fakeDb({ data: { user: { id: "u1", role: "MANAGER", status } }, error: null });
    expect(await getSessionUser(requestWithToken("t"), db)).toBeNull();
  });

  it("returns null when no session matches", async () => {
    const { db } = fakeDb({ data: null, error: null });
    expect(await getSessionUser(requestWithToken("t"), db)).toBeNull();
  });

  it("throws when the lookup fails so the route returns 500", async () => {
    const { db } = fakeDb({ data: null, error: { message: "boom" } });
    await expect(getSessionUser(requestWithToken("t"), db)).rejects.toThrow("boom");
  });
});
