import type { Role } from "./session";

/** Where a user lands after signing in, unless they were sent from a page. */
export function homeFor(role: Role): string {
  if (role === "CUSTOMER") return "/shop";
  if (role === "EMPLOYEE" || role === "MANAGER") return "/staff";
  return "/";
}

/** Only same-site paths, so `?next=` can't send users to another site. */
export function safeNextPath(next: string | string[] | undefined): string | null {
  const value = Array.isArray(next) ? next[0] : next;
  if (!value || !value.startsWith("/")) return null;
  // Browsers strip tabs and newlines and treat "\\" as "/", so "/\t/evil.example"
  // would resolve to another site. Reject those characters anywhere in the path.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  if (value.startsWith("//")) return null;
  return value;
}
