/**
 * Runs `fn` over `items` with at most `limit` calls in flight. Results keep
 * the input order. Failures are captured per item instead of rejecting the
 * whole batch, so one bad document does not abort an index run.
 */
export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  options: { shouldStop?: (error: unknown) => boolean } = {},
): Promise<Settled<R>[]> {
  const results: Settled<R>[] = new Array(items.length);
  if (items.length === 0) return results;
  const workers = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  let stopped = false;

  async function worker() {
    while (!stopped) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await fn(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
        if (options.shouldStop?.(error)) {
          stopped = true;
          return;
        }
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

/**
 * Simple in-process limiter: `limiter.run(() => ...)` queues work so that no
 * more than `limit` run at once. Used for per user preview fetches.
 */
export function createLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const release = () => {
    active -= 1;
    const nextFn = queue.shift();
    if (nextFn) nextFn();
  };

  return {
    get active() {
      return active;
    },
    get pending() {
      return queue.length;
    },
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const start = () => {
          active += 1;
          task().then(
            (value) => {
              release();
              resolve(value);
            },
            (error) => {
              release();
              reject(error);
            },
          );
        };
        if (active < limit) start();
        else queue.push(start);
      });
    },
  };
}
