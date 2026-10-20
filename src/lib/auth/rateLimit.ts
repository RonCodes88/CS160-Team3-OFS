// Fixed-window rate limiter kept in memory. It covers the single-server
// deployment (one Docker container); multiple instances would each keep their
// own counts and need a shared store instead.

type Window = { count: number; resetAt: number };

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export type RateLimiter = {
  hit(key: string): RateLimitResult;
  reset(key: string): void;
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
  };
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/** Registrations per client IP. */
export const registerLimiter = createRateLimiter({ limit: 10, windowMs: FIFTEEN_MINUTES });
/** Login attempts per client IP, across all emails. */
export const loginIpLimiter = createRateLimiter({ limit: 30, windowMs: FIFTEEN_MINUTES });
/** Login attempts per email, to slow password guessing on one account. */
export const loginEmailLimiter = createRateLimiter({ limit: 10, windowMs: FIFTEEN_MINUTES });

/** The client IP from the proxy header, or "unknown" when there is none. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}
