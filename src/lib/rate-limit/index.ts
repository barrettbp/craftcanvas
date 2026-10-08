/**
 * Per user, per minute rate limit for our own API routes (spec section 11).
 *
 * Sliding window over the last `windowMs` milliseconds, kept in process
 * memory and keyed by `bucket:userId`. It exists to blunt a hijacked session
 * hammering the Craft key through our proxy, not to meter honest traffic.
 *
 * SINGLE INSTANCE ONLY (v1). The counters live in this Node process: on a
 * host that runs several instances (Vercel functions scale out) each instance
 * counts separately, so the effective ceiling is `limit × instances`. That is
 * acceptable for a beta; move the window to Redis / Upstash when it matters.
 *
 * Usage in a route handler, after auth and before any work:
 *
 *   const limited = rateLimited(userId, "canvases"); if (limited) return limited;
 */

export type RateLimitBucket = "canvases" | "craft";

export type RateLimitConfig = { limit: number; windowMs: number };

export const RATE_LIMITS: Record<RateLimitBucket, RateLimitConfig> = {
  /** Autosave is debounced to 1.5s per tab, so 120/min leaves room for a few tabs plus list actions. */
  canvases: { limit: 120, windowMs: 60_000 },
  /** Folder tree, search (two calls per keystroke after debounce) and previews (four at a time). */
  craft: { limit: 60, windowMs: 60_000 },
};

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  /** Requests left in the window after this one (0 when limited). */
  remaining: number;
  /** Seconds until the next request is allowed; 0 when `ok`. */
  retryAfter: number;
};

const windows = new Map<string, number[]>();
let callsSinceSweep = 0;
const SWEEP_EVERY = 1000;

function sweep(now: number): void {
  const maxWindow = Math.max(...Object.values(RATE_LIMITS).map((c) => c.windowMs));
  for (const [key, hits] of windows) {
    if (hits.length === 0 || hits[hits.length - 1] <= now - maxWindow) windows.delete(key);
  }
}

/** Records a hit and says whether it is allowed. `now` and `config` are injectable for tests. */
export function checkRateLimit(userId: string, bucket: RateLimitBucket, now: number = Date.now(), config: RateLimitConfig = RATE_LIMITS[bucket]): RateLimitResult {
  const key = `${bucket}:${userId}`;
  const cutoff = now - config.windowMs;
  let hits = windows.get(key);
  if (!hits) {
    hits = [];
    windows.set(key, hits);
  }
  let expired = 0;
  while (expired < hits.length && hits[expired] <= cutoff) expired += 1;
  if (expired > 0) hits.splice(0, expired);

  if (hits.length >= config.limit) {
    const retryAfterMs = hits[0] + config.windowMs - now;
    return { ok: false, limit: config.limit, remaining: 0, retryAfter: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  hits.push(now);
  callsSinceSweep += 1;
  if (callsSinceSweep >= SWEEP_EVERY) {
    callsSinceSweep = 0;
    sweep(now);
  }
  return { ok: true, limit: config.limit, remaining: config.limit - hits.length, retryAfter: 0 };
}

export type RateLimitedBody = { error: "rate_limited"; retryAfter: number };

/** 429 with `Retry-After` and `{ error: "rate_limited", retryAfter }` (seconds). */
export function rateLimitResponse(result: RateLimitResult): Response {
  const body: RateLimitedBody = { error: "rate_limited", retryAfter: result.retryAfter };
  return Response.json(body, {
    status: 429,
    headers: {
      "Retry-After": String(result.retryAfter),
      "X-RateLimit-Limit": String(result.limit),
      "X-RateLimit-Remaining": "0",
      "Cache-Control": "no-store",
    },
  });
}

/** One-liner for handlers: the 429 response when the user is over the limit, otherwise `null`. */
export function rateLimited(userId: string, bucket: RateLimitBucket): Response | null {
  const result = checkRateLimit(userId, bucket);
  return result.ok ? null : rateLimitResponse(result);
}

/** Clears every window. Tests only. */
export function resetRateLimits(): void {
  windows.clear();
  callsSinceSweep = 0;
}

/** Number of tracked `bucket:userId` keys. Tests only. */
export function trackedKeys(): number {
  return windows.size;
}
