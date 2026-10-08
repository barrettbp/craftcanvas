import { beforeEach, describe, expect, it } from "vitest";

import { RATE_LIMITS, checkRateLimit, rateLimitResponse, rateLimited, resetRateLimits, trackedKeys } from "./index";

const T0 = 1_000_000;

describe("checkRateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to `limit` requests in a window and reports what is left", () => {
    const config = { limit: 3, windowMs: 1000 };
    expect(checkRateLimit("u1", "craft", T0, config)).toEqual({ ok: true, limit: 3, remaining: 2, retryAfter: 0 });
    expect(checkRateLimit("u1", "craft", T0 + 10, config).remaining).toBe(1);
    expect(checkRateLimit("u1", "craft", T0 + 20, config).remaining).toBe(0);
    const blocked = checkRateLimit("u1", "craft", T0 + 30, config);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfter).toBe(1);
  });

  it("slides: a request is allowed again once the oldest hit leaves the window", () => {
    const config = { limit: 2, windowMs: 1000 };
    checkRateLimit("u1", "craft", T0, config);
    checkRateLimit("u1", "craft", T0 + 500, config);
    expect(checkRateLimit("u1", "craft", T0 + 999, config).ok).toBe(false);
    // T0 falls out at T0 + 1000 (hits older than or equal to the cutoff expire).
    expect(checkRateLimit("u1", "craft", T0 + 1000, config).ok).toBe(true);
    // Now T0+500 and T0+1000 are in the window.
    expect(checkRateLimit("u1", "craft", T0 + 1100, config).ok).toBe(false);
    expect(checkRateLimit("u1", "craft", T0 + 1500, config).ok).toBe(true);
  });

  it("rounds retryAfter up to whole seconds, never below one", () => {
    const config = { limit: 1, windowMs: 60_000 };
    checkRateLimit("u1", "canvases", T0, config);
    expect(checkRateLimit("u1", "canvases", T0 + 100, config).retryAfter).toBe(60);
    expect(checkRateLimit("u1", "canvases", T0 + 59_900, config).retryAfter).toBe(1);
    expect(checkRateLimit("u1", "canvases", T0 + 59_999, config).retryAfter).toBe(1);
  });

  it("keeps users and buckets apart", () => {
    const config = { limit: 1, windowMs: 1000 };
    expect(checkRateLimit("u1", "craft", T0, config).ok).toBe(true);
    expect(checkRateLimit("u1", "craft", T0, config).ok).toBe(false);
    expect(checkRateLimit("u2", "craft", T0, config).ok).toBe(true);
    expect(checkRateLimit("u1", "canvases", T0, config).ok).toBe(true);
  });

  it("uses the documented defaults per bucket", () => {
    expect(RATE_LIMITS.canvases).toEqual({ limit: 120, windowMs: 60_000 });
    expect(RATE_LIMITS.craft).toEqual({ limit: 60, windowMs: 60_000 });
    for (let i = 0; i < 60; i += 1) expect(checkRateLimit("u1", "craft", T0 + i).ok).toBe(true);
    expect(checkRateLimit("u1", "craft", T0 + 60).ok).toBe(false);
    for (let i = 0; i < 120; i += 1) expect(checkRateLimit("u1", "canvases", T0 + i).ok).toBe(true);
    expect(checkRateLimit("u1", "canvases", T0 + 120).ok).toBe(false);
  });

  it("sweeps idle users so memory does not grow without bound", () => {
    for (let i = 0; i < 999; i += 1) checkRateLimit(`u${i}`, "craft", T0);
    expect(trackedKeys()).toBe(999);
    // The thousandth allowed call triggers a sweep, two minutes later everyone is idle.
    checkRateLimit("fresh", "craft", T0 + 120_000);
    expect(trackedKeys()).toBe(1);
  });
});

describe("rateLimited / rateLimitResponse", () => {
  beforeEach(() => resetRateLimits());

  it("answers null while under the limit and a 429 with Retry-After once over it", async () => {
    for (let i = 0; i < RATE_LIMITS.craft.limit; i += 1) expect(rateLimited("u1", "craft")).toBeNull();
    const res = rateLimited("u1", "craft");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(Number(res!.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(res!.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(await res!.json()).toEqual({ error: "rate_limited", retryAfter: Number(res!.headers.get("Retry-After")) });
  });

  it("builds the response from a result", async () => {
    const res = rateLimitResponse({ ok: false, limit: 5, remaining: 0, retryAfter: 7 });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("7");
    expect(await res.json()).toEqual({ error: "rate_limited", retryAfter: 7 });
  });
});
