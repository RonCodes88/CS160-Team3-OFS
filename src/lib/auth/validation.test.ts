import { describe, expect, it } from "vitest";
import { MAX_PASSWORD_LENGTH, normalizeEmail, parseLogin, parseRegistration } from "./validation";

describe("normalizeEmail", () => {

  it.each(["a\u0000@b.co", "a\u0001@b.co", "a\u007f@b.co"])("rejects control characters in email %j", (email) => {
    expect(parseRegistration({ email, password: "longenough" }).ok).toBe(false);
    expect(parseLogin({ email, password: "longenough" }).ok).toBe(false);
  });
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });
});

describe("parseRegistration", () => {
  it("accepts a valid email and password and normalizes the email", () => {
    expect(parseRegistration({ email: " Ana@Example.com", password: "longenough" })).toEqual({
      ok: true,
      value: { email: "ana@example.com", password: "longenough" },
    });
  });

  it("ignores extra fields such as a role", () => {
    const parsed = parseRegistration({ email: "a@b.co", password: "longenough", role: "MANAGER" });
    expect(parsed.ok && parsed.value).toEqual({ email: "a@b.co", password: "longenough" });
  });

  it.each([null, "x", 5, {}, { email: "a@b.co" }, { password: "longenough" }, { email: 1, password: "longenough" }])(
    "requires an email and password string: %o",
    (body) => {
      expect(parseRegistration(body)).toEqual({ ok: false, message: "Email and password are required." });
    },
  );

  it.each(["plain", "a@b", "a b@c.co", "@b.co", `${"a".repeat(250)}@b.co`])("rejects the email %s", (email) => {
    expect(parseRegistration({ email, password: "longenough" })).toMatchObject({ ok: false });
  });

  it("enforces the password length on both ends", () => {
    expect(parseRegistration({ email: "a@b.co", password: "1234567" }).ok).toBe(false);
    expect(parseRegistration({ email: "a@b.co", password: "12345678" }).ok).toBe(true);
    expect(parseRegistration({ email: "a@b.co", password: "x".repeat(MAX_PASSWORD_LENGTH) }).ok).toBe(true);
    expect(parseRegistration({ email: "a@b.co", password: "x".repeat(MAX_PASSWORD_LENGTH + 1) }).ok).toBe(false);
  });
});

describe("parseLogin", () => {
  it("accepts any non-empty email and password and normalizes the email", () => {
    expect(parseLogin({ email: "Ana@Example.com ", password: "x" })).toEqual({
      ok: true,
      value: { email: "ana@example.com", password: "x" },
    });
  });

  it.each([{}, { email: " ", password: "x" }, { email: "a@b.co", password: "" }])("requires both fields: %o", (body) => {
    expect(parseLogin(body)).toEqual({ ok: false, message: "Email and password are required." });
  });

  it("treats an over-long password as incorrect without hashing it", () => {
    expect(parseLogin({ email: "a@b.co", password: "x".repeat(MAX_PASSWORD_LENGTH + 1) })).toEqual({
      ok: false,
      message: "Email or password is incorrect.",
    });
  });
});
