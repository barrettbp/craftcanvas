import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./relative-time";

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("handles missing and invalid values", () => {
    expect(formatRelativeTime(null, now)).toBe("never");
    expect(formatRelativeTime("garbage", now)).toBe("unknown");
  });

  it("buckets recent times", () => {
    expect(formatRelativeTime(ago(10_000), now)).toBe("just now");
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe("5 min ago");
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toBe("3 h ago");
    expect(formatRelativeTime(ago(26 * 3_600_000), now)).toBe("yesterday");
    expect(formatRelativeTime(ago(4 * 86_400_000), now)).toBe("4 days ago");
    expect(formatRelativeTime(ago(45 * 86_400_000), now)).toBe("1 mo ago");
  });

  it("treats future times as just now and accepts Date objects", () => {
    expect(formatRelativeTime(new Date(now + 60_000), now)).toBe("just now");
    expect(formatRelativeTime(new Date(now - 120_000), now)).toBe("2 min ago");
  });
});
