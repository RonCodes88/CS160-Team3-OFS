// Request validation for register and login. Only email and password are read;
// any other field (such as a role) is ignored.

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
const MAX_EMAIL_LENGTH = 254;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Postgres text can't store NUL, and no real address has control characters.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export type Credentials = { email: string; password: string };

type Parsed = { ok: true; value: Credentials } | { ok: false; message: string };

function readFields(body: unknown): { email: unknown; password: unknown } {
  if (typeof body !== "object" || body === null) return { email: undefined, password: undefined };
  const { email, password } = body as Record<string, unknown>;
  return { email, password };
}

/** Emails are compared case-insensitively, so they are stored lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseRegistration(body: unknown): Parsed {
  const { email, password } = readFields(body);
  if (typeof email !== "string" || typeof password !== "string") {
    return { ok: false, message: "Email and password are required." };
  }
  const normalized = normalizeEmail(email);
  if (normalized.length > MAX_EMAIL_LENGTH || !EMAIL.test(normalized) || CONTROL_CHARS.test(normalized)) {
    return { ok: false, message: "Enter a valid email address." };
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `Password must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`,
    };
  }
  return { ok: true, value: { email: normalized, password } };
}

/** Login only checks shape; a wrong email or password is reported as invalid credentials. */
export function parseLogin(body: unknown): Parsed {
  const { email, password } = readFields(body);
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    return { ok: false, message: "Email and password are required." };
  }
  // Longer passwords can't exist, and hashing them would waste work.
  if (password.length > MAX_PASSWORD_LENGTH || email.length > MAX_EMAIL_LENGTH || CONTROL_CHARS.test(email.trim())) {
    return { ok: false, message: "Email or password is incorrect." };
  }
  return { ok: true, value: { email: normalizeEmail(email), password } };
}
