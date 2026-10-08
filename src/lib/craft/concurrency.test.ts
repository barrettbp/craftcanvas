import { describe, expect, it } from "vitest";

import { createLimiter, mapWithConcurrency } from "./concurrency";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("mapWithConcurrency", () => {
  it("never exceeds the limit and keeps input order", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    const results = await mapWithConcurrency(items, 4, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, (10 - n) % 3));
      active -= 1;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(results.map((r) => (r.ok ? r.value : "err"))).toEqual(items.map((n) => n * 2));
  });

  it("captures per item failures without aborting the batch", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("nope");
      return n;
    });
    expect(results[0]).toEqual({ ok: true, value: 1 });
    expect(results[1].ok).toBe(false);
    expect(results[2]).toEqual({ ok: true, value: 3 });
  });

  it("stops scheduling new work when shouldStop matches", async () => {
    const seen: number[] = [];
    const results = await mapWithConcurrency(
      [1, 2, 3, 4, 5, 6],
      1,
      async (n) => {
        seen.push(n);
        if (n === 2) throw new Error("fatal");
        return n;
      },
      { shouldStop: (e) => e instanceof Error && e.message === "fatal" },
    );
    expect(seen).toEqual([1, 2]);
    expect(results.filter(Boolean)).toHaveLength(2);
  });

  it("handles an empty list and a limit below 1", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
    const out = await mapWithConcurrency([1], 0, async (n) => n);
    expect(out).toEqual([{ ok: true, value: 1 }]);
  });
});

describe("createLimiter", () => {
  it("queues tasks beyond the limit", async () => {
    const limiter = createLimiter(2);
    const gates = [deferred<number>(), deferred<number>(), deferred<number>()];
    const runs = gates.map((g) => limiter.run(() => g.promise));
    expect(limiter.active).toBe(2);
    expect(limiter.pending).toBe(1);
    gates[0].resolve(1);
    await runs[0];
    expect(limiter.active).toBe(2);
    expect(limiter.pending).toBe(0);
    gates[1].resolve(2);
    gates[2].resolve(3);
    expect(await Promise.all(runs)).toEqual([1, 2, 3]);
    expect(limiter.active).toBe(0);
  });

  it("releases the slot when a task rejects", async () => {
    const limiter = createLimiter(1);
    await expect(limiter.run(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(limiter.active).toBe(0);
    expect(await limiter.run(async () => "ok")).toBe("ok");
  });
});
