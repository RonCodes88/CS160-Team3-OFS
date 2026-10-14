import { afterEach, describe, expect, it, vi } from "vitest";
import { checkEnvOnStartup } from "./envStartup";

const VALID = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
  STRIPE_SECRET_KEY: "sk_test_x",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  MAPBOX_ACCESS_TOKEN: "sk.x",
  NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: "pk.x",
};

afterEach(() => vi.restoreAllMocks());

function spies() {
  return {
    exit: vi.spyOn(process, "exit").mockImplementation((() => undefined) as never),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
  };
}

describe("checkEnvOnStartup", () => {
  it("does nothing when the environment is valid", () => {
    const s = spies();
    checkEnvOnStartup({ ...VALID, NODE_ENV: "production" });
    expect(s.exit).not.toHaveBeenCalled();
    expect(s.error).not.toHaveBeenCalled();
    expect(s.warn).not.toHaveBeenCalled();
  });

  it("exits with code 1 in production when a variable is missing", () => {
    const s = spies();
    checkEnvOnStartup({ ...VALID, STRIPE_SECRET_KEY: undefined, NODE_ENV: "production" });
    expect(s.error).toHaveBeenCalledWith(expect.stringContaining("STRIPE_SECRET_KEY is missing"));
    expect(s.exit).toHaveBeenCalledWith(1);
  });

  it("only warns in development so the app can still boot", () => {
    const s = spies();
    checkEnvOnStartup({ ...VALID, STRIPE_SECRET_KEY: "sk_live_x", NODE_ENV: "development" });
    expect(s.warn).toHaveBeenCalledWith(expect.stringContaining("STRIPE_SECRET_KEY must start with sk_test_"));
    expect(s.exit).not.toHaveBeenCalled();
  });
});
