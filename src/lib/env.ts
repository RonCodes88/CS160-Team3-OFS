// Every environment variable the app reads, with a format check for each.
// .env.example lists the same variables; keep the two in sync.
//
// NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so
// only publishable keys may use that prefix. Secrets must not.

type EnvVar = {
  name: string;
  /** Shown when the variable is missing or malformed. */
  hint: string;
  /** Returns an error message, or null when the value is acceptable. */
  check?: (value: string) => string | null;
};

const isUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? null : "must be an http(s) URL";
  } catch {
    return "must be a URL";
  }
};

const prefixed =
  (prefixes: string[], why = "") =>
  (value: string) =>
    prefixes.some((p) => value.startsWith(p)) ? null : `must start with ${prefixes.join(" or ")}${why}`;

export const ENV_VARS: readonly EnvVar[] = [
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    hint: "Supabase dashboard -> Project Settings -> API",
    check: isUrl,
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    hint: "Supabase dashboard -> Project Settings -> API Keys",
  },
  {
    name: "SUPABASE_SECRET_KEY",
    hint: "Supabase dashboard -> Project Settings -> API Keys -> Secret keys",
  },
  {
    name: "STRIPE_SECRET_KEY",
    hint: "Stripe dashboard (test mode) -> Developers -> API keys",
    check: prefixed(["sk_test_", "rk_test_"], " (OFS uses Stripe test mode only)"),
  },
  {
    name: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    hint: "Stripe dashboard (test mode) -> Developers -> API keys",
    check: prefixed(["pk_test_"], " (OFS uses Stripe test mode only)"),
  },
  {
    name: "STRIPE_WEBHOOK_SECRET",
    hint: "`stripe listen` output, or Stripe dashboard -> Webhooks -> signing secret",
    check: prefixed(["whsec_"]),
  },
  {
    name: "MAPBOX_ACCESS_TOKEN",
    hint: "Mapbox account -> Tokens (server-side geocoding and routing)",
    check: prefixed(["pk.", "sk."]),
  },
  {
    name: "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN",
    hint: "Mapbox account -> Tokens (a public pk. token, URL-restricted)",
    check: prefixed(["pk."], " (sk. tokens are secret and must not reach the browser)"),
  },
];

export type EnvProblem = { name: string; message: string };

/** Lists every missing or malformed variable in `env`. */
export function findEnvProblems(env: Record<string, string | undefined>): EnvProblem[] {
  const problems: EnvProblem[] = [];
  for (const v of ENV_VARS) {
    const value = env[v.name]?.trim();
    if (!value) {
      problems.push({ name: v.name, message: `${v.name} is missing (${v.hint})` });
      continue;
    }
    const error = v.check?.(value);
    if (error) problems.push({ name: v.name, message: `${v.name} ${error}` });
  }
  return problems;
}

/** One readable block listing every problem, for logs and thrown errors. */
export function formatEnvProblems(problems: readonly EnvProblem[]): string {
  return [
    "Environment is not configured correctly:",
    ...problems.map((p) => `  - ${p.message}`),
    "Copy .env.example to .env.local and fill in the values (see README).",
  ].join("\n");
}
