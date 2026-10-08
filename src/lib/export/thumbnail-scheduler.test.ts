import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createThumbnailScheduler } from "./thumbnail-scheduler";

describe("createThumbnailScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs immediately on the first save", () => {
    const run = vi.fn();
    const s = createThumbnailScheduler(run, { intervalMs: 30_000 });
    s.notify();
    expect(run).toHaveBeenCalledTimes(1);
    expect(s.pending).toBe(false);
    expect(s.lastRunAt).toBe(Date.now());
  });

  it("coalesces saves inside the window into one trailing run at the 30s mark", () => {
    const run = vi.fn();
    const s = createThumbnailScheduler(run, { intervalMs: 30_000 });
    s.notify();
    vi.advanceTimersByTime(5_000);
    s.notify();
    vi.advanceTimersByTime(5_000);
    s.notify();
    expect(run).toHaveBeenCalledTimes(1);
    expect(s.pending).toBe(true);

    vi.advanceTimersByTime(19_999);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(s.pending).toBe(false);
  });

  it("runs at most once per interval over a long burst of saves", () => {
    const run = vi.fn();
    const s = createThumbnailScheduler(run, { intervalMs: 30_000 });
    for (let t = 0; t < 120_000; t += 1_500) {
      s.notify();
      vi.advanceTimersByTime(1_500);
    }
    // t = 0, 30s, 60s, 90s and the trailing run at 120s
    expect(run).toHaveBeenCalledTimes(5);
  });

  it("runs immediately again once the window has passed", () => {
    const run = vi.fn();
    const s = createThumbnailScheduler(run, { intervalMs: 30_000 });
    s.notify();
    vi.advanceTimersByTime(31_000);
    s.notify();
    expect(run).toHaveBeenCalledTimes(2);
    expect(s.pending).toBe(false);
  });

  it("honours a last run carried over from an earlier mount", () => {
    const run = vi.fn();
    const s = createThumbnailScheduler(run, { intervalMs: 30_000, lastRunAt: Date.now() - 10_000 });
    s.notify();
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("dispose cancels a pending run and ignores later notifications", () => {
    const run = vi.fn();
    const s = createThumbnailScheduler(run, { intervalMs: 30_000 });
    s.notify();
    s.notify();
    expect(s.pending).toBe(true);
    s.dispose();
    expect(s.pending).toBe(false);
    vi.advanceTimersByTime(60_000);
    s.notify();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
