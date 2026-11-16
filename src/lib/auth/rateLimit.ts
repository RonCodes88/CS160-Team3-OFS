// In-memory fixed-window implementation for deterministic test adapters.
// Production auth routes use PostgreSQL counters in sharedRateLimit.ts.

type Window = { count: number; resetAt: number };

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export type RateLimiter = {
  hit(key: string): RateLimitResult;
  reset(key: string): void;
  /** Takes back one hit, so a request that turned out fine doesn't count. */
  refund(key: string): void;
};

const MAX_TRACKED_KEYS = 10_000;

export function createRateLimiter(
  { limit, windowMs }: { limit: number; windowMs: number },
  now: () => number = Date.now,
): RateLimiter {
  const windows = new Map<string, Window>();

  function prune(time: number) {
    for (const [key, window] of windows) {
      if (window.resetAt <= time) windows.delete(key);
    }
  }

  return {
    hit(key) {
      const time = now();
      let window = windows.get(key);
      if (!window || window.resetAt <= time) {
        if (windows.size >= MAX_TRACKED_KEYS) prune(time);
        // Still full of live windows: drop the oldest so memory stays bounded.
        if (windows.size >= MAX_TRACKED_KEYS) {
          const oldest = windows.keys().next().value;
          if (oldest !== undefined) windows.delete(oldest);
        }
        window = { count: 0, resetAt: time + windowMs };
        windows.set(key, window);
      }
      window.count += 1;
      if (window.count > limit) {
        return { ok: false, retryAfterSeconds: Math.ceil((window.resetAt - time) / 1000) };
      }
      return { ok: true };
    },
    reset(key) {
      windows.delete(key);
    },
    refund(key) {
      const window = windows.get(key);
      if (window && window.count > 0) window.count -= 1;
    },
  };
}

/**
 * Key for the per-account limiter. Including the IP means someone else's wrong
 * guesses can't lock the real owner out from their own network.
 */
export function loginAttemptKey(email: string, ip: string): string {
  return `${email}|${ip}`;
}

/** The client IP from the proxy header, or "unknown" when there is none. */
export function clientIp(request: Request, trustProxy = process.env.OFS_TRUST_PROXY_HEADERS === "true"): string {
  // Fetch Request has no peer socket. Only accept a header overwritten by our proxy.
  if (!trustProxy) return "unknown";
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}
