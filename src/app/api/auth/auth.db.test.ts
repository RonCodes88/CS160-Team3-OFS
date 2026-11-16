import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as login } from "./login/route";
import { POST as logout } from "./logout/route";
import { GET as me } from "./me/route";
import { POST as register } from "./register/route";
import { GET as staffInventory } from "@/app/api/staff/inventory/route";
import { hashPassword } from "@/lib/auth/password";
import { hashSessionToken, SESSION_COOKIE } from "@/lib/auth/session";

// Runs the real auth routes against a LOCAL Supabase with the migrations applied.
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

const run = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${run}@auth.test`;
const PASSWORD = "correct horse battery";

const limitKeys = new Set<string>();
function post(path: string, body: unknown, cookie?: string) {
  const ip = randomUUID();
  limitKeys.add(ip);
  if (body && typeof body === "object" && "email" in body && typeof body.email === "string") {
    const normalized = body.email.trim().toLowerCase();
    limitKeys.add(normalized);
    limitKeys.add(`${normalized}|${ip}`);
  }
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip };
  if (cookie) headers.cookie = cookie;
  return new NextRequest(`http://localhost${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function get(path: string, cookie?: string) {
  return new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });
}

/** "ofs_session=<token>" from a Set-Cookie header. */
function sessionCookie(res: Response): string {
  const match = res.headers.get("set-cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) throw new Error("no session cookie");
  return `${SESSION_COOKIE}=${match[1]}`;
}

describe.skipIf(!TEST_URL || !TEST_KEY)("auth routes against Postgres", () => {
  let db: SupabaseClient;

  beforeAll(() => {
    process.env.OFS_TRUST_PROXY_HEADERS = "true";
    process.env.NEXT_PUBLIC_SUPABASE_URL = TEST_URL;
    process.env.SUPABASE_SECRET_KEY = TEST_KEY;
    db = createClient(TEST_URL!, TEST_KEY!, { auth: { persistSession: false } });
  });

  afterAll(async () => {
    if (db) {
      await db.from("users").delete().like("email", `%-${run}@auth.test`);
      await db.from("auth_rate_limits").delete().in("key_hash", [...limitKeys].map(key => createHash("sha256").update(key).digest("hex")));
    }
  });

  async function userRow(address: string) {
    const { data } = await db.from("users").select("*").eq("email", address).single();
    return data as { id: string; email: string; role: string; password_hash: string; last_login_at: string | null };
  }

  it("registers a customer, stores only a password hash, and starts a session", async () => {
    const res = await register(post("/api/auth/register", { email: email("NEW").toUpperCase(), password: PASSWORD }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ user: { id: expect.any(String), email: email("new"), role: "CUSTOMER" } });
    expect(JSON.stringify(body)).not.toMatch(/hash|password/i);

    const row = await userRow(email("new"));
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.password_hash).not.toContain(PASSWORD);

    // The session row holds the token's hash, never the token itself.
    const token = sessionCookie(res).split("=")[1];
    const { data: sessions } = await db.from("auth_sessions").select("token_hash, expires_at").eq("user_id", row.id);
    expect(sessions).toEqual([{ token_hash: hashSessionToken(token), expires_at: expect.any(String) }]);
    expect(await (await me(get("/api/auth/me", sessionCookie(res)))).json()).toEqual(body);
  });

  it("only creates CUSTOMER accounts, whatever role is sent", async () => {
    for (const role of ["MANAGER", "EMPLOYEE", "VEHICLE"]) {
      const res = await register(post("/api/auth/register", { email: email(`role-${role.toLowerCase()}`), password: PASSWORD, role }));
      expect((await res.json()).user.role).toBe("CUSTOMER");
      expect((await userRow(email(`role-${role.toLowerCase()}`))).role).toBe("CUSTOMER");
    }
  });

  it("rejects a duplicate email, ignoring case", async () => {
    await register(post("/api/auth/register", { email: email("dup"), password: PASSWORD }));
    const res = await register(post("/api/auth/register", { email: email("DUP").toUpperCase(), password: PASSWORD }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("EMAIL_TAKEN");
  });

  it("logs in with the right password, with any email casing, and records the login", async () => {
    await register(post("/api/auth/register", { email: email("login"), password: PASSWORD }));
    const res = await login(post("/api/auth/login", { email: ` ${email("LOGIN").toUpperCase()} `, password: PASSWORD }));
    expect(res.status).toBe(200);
    expect((await res.json()).user.email).toBe(email("login"));
    expect((await userRow(email("login"))).last_login_at).not.toBeNull();
  });

  it("returns the same 401 for a wrong password and an unknown email", async () => {
    await register(post("/api/auth/register", { email: email("wrong"), password: PASSWORD }));
    const wrong = await login(post("/api/auth/login", { email: email("wrong"), password: "nope nope" }));
    const unknown = await login(post("/api/auth/login", { email: email("ghost"), password: PASSWORD }));
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(unknown.status).toBe(401);
  });

  async function insertUser(row: object) {
    const { error } = await db.from("users").insert({ password_hash: await hashPassword(PASSWORD), ...row });
    if (error) throw new Error(`users insert failed: ${error.message}`);
  }

  it.each(["DISABLED", "LOCKED"])("refuses to log in a %s account", async (status) => {
    const address = email(status.toLowerCase());
    await insertUser({ email: address, status });
    const res = await login(post("/api/auth/login", { email: address, password: PASSWORD }));
    expect(res.status).toBe(401);
  });

  it("the database rejects an email that isn't lowercase", async () => {
    const { error } = await db.from("users").insert({ email: email("Mixed"), password_hash: "x" });
    expect(error?.message).toMatch(/users_email_lowercase/);
  });

  it("logs in staff, whose session then passes the staff role check", async () => {
    await insertUser({ email: email("staff"), role: "EMPLOYEE" });
    const res = await login(post("/api/auth/login", { email: email("staff"), password: PASSWORD }));
    expect((await res.json()).user.role).toBe("EMPLOYEE");
    expect((await staffInventory(get("/api/staff/inventory?limit=1", sessionCookie(res)))).status).toBe(200);
  });

  it("a customer session gets 403 from staff routes", async () => {
    const res = await register(post("/api/auth/register", { email: email("nosy"), password: PASSWORD }));
    expect((await staffInventory(get("/api/staff/inventory", sessionCookie(res)))).status).toBe(403);
  });

  it("logout revokes the session for every later request", async () => {
    const res = await register(post("/api/auth/register", { email: email("bye"), password: PASSWORD }));
    const cookie = sessionCookie(res);
    expect((await me(get("/api/auth/me", cookie))).status).toBe(200);

    expect((await logout(post("/api/auth/logout", {}, cookie))).status).toBe(200);
    expect((await me(get("/api/auth/me", cookie))).status).toBe(401);
    const { id } = await userRow(email("bye"));
    const { data } = await db.from("auth_sessions").select("revoked_at").eq("user_id", id).single();
    expect(data?.revoked_at).not.toBeNull();
  });

  it("an expired session is rejected", async () => {
    const res = await register(post("/api/auth/register", { email: email("old"), password: PASSWORD }));
    const cookie = sessionCookie(res);
    await db
      .from("auth_sessions")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("token_hash", hashSessionToken(cookie.split("=")[1]));
    expect((await me(get("/api/auth/me", cookie))).status).toBe(401);
  });

  it("the seeded demo accounts log in with the documented password", async () => {
    const { data } = await db.from("users").select("email").eq("email", "customer.test@ofs.local").maybeSingle();
    if (!data) return; // Seed not loaded in this database.
    const res = await login(post("/api/auth/login", { email: "customer.test@ofs.local", password: "ChangeMe123!" }));
    expect(res.status).toBe(200);
  });
});
