import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "./rateLimit";

function limiter(limit = 3, windowMs = 1000) {
  let time = 0;
  const rl = createRateLimiter({ limit, windowMs }, () => time);
  return { rl, advance: (ms: number) => (time += ms) };
}

describe("createRateLimiter", () => {
  it("allows up to the limit, then blocks with a retry time", () => {
    const { rl, advance } = limiter();
    expect([rl.hit("k"), rl.hit("k"), rl.hit("k")].every((r) => r.ok)).toBe(true);
    advance(400);
    expect(rl.hit("k")).toEqual({ ok: false, retryAfterSeconds: 1 });
  });

  it("opens again when the window ends", () => {
    const { rl, advance } = limiter(1);
    rl.hit("k");
    expect(rl.hit("k").ok).toBe(false);
    advance(1000);
    expect(rl.hit("k").ok).toBe(true);
  });

  it("counts keys separately", () => {
    const { rl } = limiter(1);
    rl.hit("a");
    expect(rl.hit("a").ok).toBe(false);
    expect(rl.hit("b").ok).toBe(true);
  });

  it("reset clears a key", () => {
    const { rl } = limiter(1);
    rl.hit("k");
    rl.reset("k");
    expect(rl.hit("k").ok).toBe(true);
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => new Request("http://x/", { headers });

  it("uses the first x-forwarded-for address", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip, then unknown", () => {
    expect(clientIp(req({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(req({}))).toBe("unknown");
  });
});
