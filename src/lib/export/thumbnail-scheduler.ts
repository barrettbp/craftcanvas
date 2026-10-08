/**
 * Throttle for thumbnail captures: `notify()` after every successful save,
 * `run` happens at most once per `intervalMs`. The first notification runs
 * right away; later ones within the window coalesce into one trailing run so
 * the newest state is what gets captured. Framework free and timer injectable
 * so it can be tested with fake timers.
 */
export const THUMBNAIL_INTERVAL_MS = 30_000;

export type ThumbnailSchedulerOptions = {
  intervalMs?: number;
  /** When the last run happened (ms epoch), e.g. carried over from a previous mount of the same canvas. */
  lastRunAt?: number | null;
  now?: () => number;
  setTimeoutImpl?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutImpl?: (t: ReturnType<typeof setTimeout>) => void;
};

export type ThumbnailScheduler = {
  /** A save succeeded; capture now or at the end of the current window. */
  notify: () => void;
  /** Drop a pending trailing run. */
  dispose: () => void;
  readonly pending: boolean;
  readonly lastRunAt: number | null;
};

export function createThumbnailScheduler(run: () => void, options: ThumbnailSchedulerOptions = {}): ThumbnailScheduler {
  const intervalMs = options.intervalMs ?? THUMBNAIL_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const setT = options.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = options.clearTimeoutImpl ?? ((t) => clearTimeout(t));

  let lastRunAt: number | null = options.lastRunAt ?? null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function fire() {
    lastRunAt = now();
    run();
  }

  return {
    notify() {
      if (disposed || timer !== null) return;
      const elapsed = lastRunAt === null ? Infinity : now() - lastRunAt;
      if (elapsed >= intervalMs) {
        fire();
        return;
      }
      timer = setT(() => {
        timer = null;
        fire();
      }, intervalMs - elapsed);
    },
    dispose() {
      disposed = true;
      if (timer !== null) {
        clearT(timer);
        timer = null;
      }
    },
    get pending() {
      return timer !== null;
    },
    get lastRunAt() {
      return lastRunAt;
    },
  };
}
