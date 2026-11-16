import { describe, expect, it } from "vitest";
import { ENV_VARS, findEnvProblems, formatEnvProblems } from "./env";

const VALID = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
  STRIPE_SECRET_KEY: "sk_test_x",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  MAPBOX_ACCESS_TOKEN: "sk.x",
  NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: "pk.x",
  OFS_STORE_LATITUDE: "37.3352",
  OFS_STORE_LONGITUDE: "-121.8811",
  OFS_DELIVERY_RADIUS_METERS: "5000",
};

const messages = (env: Record<string, string | undefined>) => findEnvProblems(env).map((p) => p.message);

describe("findEnvProblems", () => {
  it("accepts a complete, valid environment", () => {
    expect(findEnvProblems(VALID)).toEqual([]);
  });

  it("covers exactly the variables in the valid fixture", () => {
    expect(ENV_VARS.map((v) => v.name).sort()).toEqual(Object.keys(VALID).sort());
  });

  it("reports every missing variable, not just the first", () => {
    expect(findEnvProblems({}).map((p) => p.name)).toEqual(ENV_VARS.map((v) => v.name));
  });

  it("treats blank values as missing", () => {
    expect(messages({ ...VALID, SUPABASE_SECRET_KEY: "   " })).toEqual([
      expect.stringContaining("SUPABASE_SECRET_KEY is missing"),
    ]);
  });

  it("rejects a Supabase URL that isn't http(s)", () => {
    expect(messages({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: "not a url" })).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL must be a URL",
    ]);
    expect(messages({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: "ftp://x" })).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL must be an http(s) URL",
    ]);
  });

  it("rejects live Stripe keys", () => {
    expect(messages({ ...VALID, STRIPE_SECRET_KEY: "sk_live_x", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_x" })).toEqual([
      "STRIPE_SECRET_KEY must start with sk_test_ or rk_test_ (OFS uses Stripe test mode only)",
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must start with pk_test_ (OFS uses Stripe test mode only)",
    ]);
  });

  it("accepts a restricted test-mode Stripe key", () => {
    expect(findEnvProblems({ ...VALID, STRIPE_SECRET_KEY: "rk_test_x" })).toEqual([]);
  });

  it("rejects a malformed webhook secret", () => {
    expect(messages({ ...VALID, STRIPE_WEBHOOK_SECRET: "abc" })).toEqual(["STRIPE_WEBHOOK_SECRET must start with whsec_"]);
  });

  it("never allows a secret Mapbox token in the browser", () => {
    expect(messages({ ...VALID, NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: "sk.x" })).toEqual([
      "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN must start with pk. (sk. tokens are secret and must not reach the browser)",
    ]);
  });

  it("accepts a public or secret Mapbox token on the server", () => {
    expect(findEnvProblems({ ...VALID, MAPBOX_ACCESS_TOKEN: "pk.x" })).toEqual([]);
  });
});

describe("formatEnvProblems", () => {
  it("names every problem and says how to fix it", () => {
    const env = { ...VALID, STRIPE_SECRET_KEY: undefined, NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: "sk.x" };
    expect(formatEnvProblems(findEnvProblems(env))).toBe(
      [
        "Environment is not configured correctly:",
        "  - STRIPE_SECRET_KEY is missing (Stripe dashboard (test mode) -> Developers -> API keys)",
        "  - NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN must start with pk. (sk. tokens are secret and must not reach the browser)",
        "Copy .env.example to .env.local and fill in the values (see README).",
      ].join("\n"),
    );
  });
});

it("rejects service-area settings that aren't usable numbers", () => {
  expect(messages({ ...VALID, OFS_STORE_LATITUDE: "91" })).toEqual(["OFS_STORE_LATITUDE must be a number from -90 to 90"]);
  expect(messages({ ...VALID, OFS_STORE_LONGITUDE: "west" })).toEqual(["OFS_STORE_LONGITUDE must be a number from -180 to 180"]);
  expect(messages({ ...VALID, OFS_DELIVERY_RADIUS_METERS: "0" })).toEqual([
    "OFS_DELIVERY_RADIUS_METERS must be a positive number of meters",
  ]);
});

describe(".env.example", () => {
  it("lists every variable the app checks, with placeholder values only", async () => {
    const { readFile } = await import("node:fs/promises");
    const example = await readFile(new URL("../../.env.example", import.meta.url), "utf8");
    const defined = new Map(
      example
        .split("\n")
        .filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => line.split("=", 2) as [string, string]),
    );
    for (const v of ENV_VARS) expect(defined.has(v.name), `${v.name} missing from .env.example`).toBe(true);
    // Placeholders end in xxx or are obviously fake, never real-looking keys.
    // The service area is public configuration, so its real values are listed.
    const publicSettings = new Set(["OFS_STORE_LATITUDE", "OFS_STORE_LONGITUDE", "OFS_DELIVERY_RADIUS_METERS", "OFS_DELIVERY_WAIT_MINUTES", "OFS_EMAIL_PROVIDER", "OFS_TRUST_PROXY_HEADERS", "OFS_ROBOT_BASE_URL", "OFS_ROBOT_POLL_MS", "OFS_ROBOT_STEP_MS", "OFS_IN_APP_WORKERS", "OFS_IN_APP_ROBOT"]);
    expect(defined.get("OFS_DELIVERY_WAIT_MINUTES")).toBe("20");
    for (const [name, value] of defined) {
      if (!publicSettings.has(name) && value !== "") expect(value, name).toMatch(/xxx|your-project-ref/);
    }
  });
});
