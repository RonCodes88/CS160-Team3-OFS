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
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}
