import { findEnvProblems, formatEnvProblems } from "@/lib/env";

/**
 * A production server with a missing or malformed variable exits instead of
 * serving requests. In development the app still boots so you can see the
 * setup page, but every problem is printed up front.
 */
export function checkEnvOnStartup(env: Record<string, string | undefined> = process.env): void {
  const problems = findEnvProblems(env);
  if (problems.length === 0) return;

  if (env.NODE_ENV === "production") {
    console.error(formatEnvProblems(problems));
    // Throwing from register() only logs "Failed to prepare server" and leaves
    // the process running, so exit explicitly.
    process.exit(1);
  }
  console.warn(formatEnvProblems(problems));
}
