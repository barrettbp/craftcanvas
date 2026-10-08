import { describe, expect, it } from "vitest";

import { isRefreshInFlight, isStale, MIN_REFRESH_INTERVAL_MS, refreshRetryAfterSeconds, STALE_AFTER_MS } from "./indexer";

describe("refreshRetryAfterSeconds", () => {
  const now = new Date("2026-10-08T12:00:00Z");

  it("allows a refresh when there was none yet", () => {
    expect(refreshRetryAfterSeconds(null, now)).toBe(0);
    expect(refreshRetryAfterSeconds(undefined, now)).toBe(0);
  });

  it("blocks within a minute and reports the remaining seconds", () => {
    expect(refreshRetryAfterSeconds(new Date(now.getTime() - 10_000), now)).toBe(50);
    expect(refreshRetryAfterSeconds(new Date(now.getTime() - 59_500), now)).toBe(1);
    expect(refreshRetryAfterSeconds(new Date(now.getTime() - MIN_REFRESH_INTERVAL_MS), now)).toBe(0);
    expect(refreshRetryAfterSeconds(new Date(now.getTime() - 120_000), now)).toBe(0);
  });

  it("never reports less than one second while blocked", () => {
    expect(refreshRetryAfterSeconds(new Date(now.getTime() - 59_999), now)).toBe(1);
  });
});

describe("isStale", () => {
  const now = new Date("2026-10-08T12:00:00Z");

  it("treats never synced and old syncs as stale", () => {
    expect(isStale(null, now)).toBe(true);
    expect(isStale(new Date(now.getTime() - STALE_AFTER_MS - 1), now)).toBe(true);
  });

  it("treats a recent sync as fresh", () => {
    expect(isStale(new Date(now.getTime() - 5 * 60_000), now)).toBe(false);
    expect(isStale(new Date(now.getTime() - STALE_AFTER_MS), now)).toBe(false);
  });
});

describe("isRefreshInFlight", () => {
  it("is false for an unknown user", () => {
    expect(isRefreshInFlight("nobody")).toBe(false);
  });
});
