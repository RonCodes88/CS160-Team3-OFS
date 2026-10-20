import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as login } from "./login/route";
import { POST as logout } from "./logout/route";
import { GET as me } from "./me/route";
import { POST as register } from "./register/route";
import { authenticate, registerCustomer } from "@/lib/auth/accounts";
import { createSession, getSessionUser, revokeSession, SESSION_COOKIE } from "@/lib/auth/session";

// Route behavior with the account and session functions mocked.
// auth.db.test.ts runs the same routes against Postgres.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/accounts", () => ({ registerCustomer: vi.fn(), authenticate: vi.fn() }));
vi.mock("@/lib/auth/session", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/auth/session")>()),
  createSession: vi.fn(),
  revokeSession: vi.fn(),
  getSessionUser: vi.fn(),
}));

const CUSTOMER = { id: "u1", email: "ana@example.com", role: "CUSTOMER" as const };
const SESSION = { token: "raw-token", expiresAt: new Date("2030-01-01T00:00:00Z") };

// Each test gets its own IP so the shared rate limiters don't interfere.
function post(path: string, body: unknown, { contentType = "application/json", ip = randomUUID() } = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": contentType, "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createSession).mockResolvedValue(SESSION);
});

describe("POST /api/auth/register", () => {
  it("creates a customer, returns it without secrets, and sets an httpOnly session cookie", async () => {
    vi.mocked(registerCustomer).mockResolvedValue({ ok: true, user: CUSTOMER });
    const res = await register(post("/api/auth/register", { email: "Ana@Example.com", password: "longenough", role: "MANAGER" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ user: CUSTOMER });
    expect(registerCustomer).toHaveBeenCalledWith({}, { email: "ana@example.com", password: "longenough" });
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${SESSION_COOKIE}=raw-token`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
  });

  it("returns 409 for a taken email", async () => {
    vi.mocked(registerCustomer).mockResolvedValue({ ok: false, reason: "EMAIL_TAKEN" });
    const res = await register(post("/api/auth/register", { email: "a@b.co", password: "longenough" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("EMAIL_TAKEN");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("returns 400 for invalid input without creating anything", async () => {
    const res = await register(post("/api/auth/register", { email: "nope", password: "short" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    expect(registerCustomer).not.toHaveBeenCalled();
  });

  it("rejects non-JSON bodies (blocks cross-site form posts) and malformed JSON", async () => {
    expect((await register(post("/api/auth/register", "email=a", { contentType: "application/x-www-form-urlencoded" }))).status).toBe(415);
    expect((await register(post("/api/auth/register", "{"))).status).toBe(400);
  });

  it("rate-limits registrations per IP", async () => {
    vi.mocked(registerCustomer).mockResolvedValue({ ok: false, reason: "EMAIL_TAKEN" });
    const ip = randomUUID();
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await register(post("/api/auth/register", { email: "a@b.co", password: "longenough" }, { ip }))).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 409)).toBe(true);
    const blocked = await register(post("/api/auth/register", { email: "a@b.co", password: "longenough" }, { ip }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("returns a generic 500 when something unexpected fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(registerCustomer).mockRejectedValue(new Error("db down"));
    const res = await register(post("/api/auth/register", { email: "a@b.co", password: "longenough" }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("db down");
  });
});

describe("POST /api/auth/login", () => {
  it("signs in and sets the session cookie", async () => {
    vi.mocked(authenticate).mockResolvedValue(CUSTOMER);
    const res = await login(post("/api/auth/login", { email: "ANA@example.com", password: "pw" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: CUSTOMER });
    expect(authenticate).toHaveBeenCalledWith({}, { email: "ana@example.com", password: "pw" });
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=raw-token`);
  });

  it("returns 401 INVALID_CREDENTIALS without a cookie for bad credentials", async () => {
    vi.mocked(authenticate).mockResolvedValue(null);
    const res = await login(post("/api/auth/login", { email: "a@b.co", password: "wrong" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." },
    });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rate-limits repeated attempts on one email, across IPs", async () => {
    vi.mocked(authenticate).mockResolvedValue(null);
    const email = `${randomUUID()}@b.co`;
    for (let i = 0; i < 10; i++) await login(post("/api/auth/login", { email, password: "wrong" }));
    const res = await login(post("/api/auth/login", { email, password: "wrong" }));
    expect(res.status).toBe(429);
    expect(authenticate).toHaveBeenCalledTimes(10);
  });

  it("rate-limits attempts from one IP, across emails", async () => {
    vi.mocked(authenticate).mockResolvedValue(null);
    const ip = randomUUID();
    for (let i = 0; i < 30; i++) await login(post("/api/auth/login", { email: `${i}@b.co`, password: "x" }, { ip }));
    expect((await login(post("/api/auth/login", { email: "z@b.co", password: "x" }, { ip }))).status).toBe(429);
  });

  it("clears the email's failure count after a successful login", async () => {
    const email = `${randomUUID()}@b.co`;
    vi.mocked(authenticate).mockResolvedValue(null);
    for (let i = 0; i < 9; i++) await login(post("/api/auth/login", { email, password: "wrong" }));
    vi.mocked(authenticate).mockResolvedValueOnce(CUSTOMER);
    expect((await login(post("/api/auth/login", { email, password: "right" }))).status).toBe(200);
    expect((await login(post("/api/auth/login", { email, password: "wrong" }))).status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes the session and clears the cookie", async () => {
    const req = new NextRequest("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=raw-token` },
    });
    const res = await logout(req);
    expect(res.status).toBe(200);
    expect(revokeSession).toHaveBeenCalledWith({}, "raw-token");
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE}=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)`, "i"));
  });

  it("is a no-op when already signed out", async () => {
    const res = await logout(new NextRequest("http://localhost/api/auth/logout", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(revokeSession).not.toHaveBeenCalled();
  });
});

describe("GET /api/auth/me", () => {
  it("returns the signed-in user", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(CUSTOMER);
    const res = await me(new NextRequest("http://localhost/api/auth/me"));
    expect(await res.json()).toEqual({ user: CUSTOMER });
  });

  it("returns 401 when signed out", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    expect((await me(new NextRequest("http://localhost/api/auth/me"))).status).toBe(401);
  });
});
