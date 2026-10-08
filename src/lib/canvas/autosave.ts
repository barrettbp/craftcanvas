/**
 * Autosave pipeline (spec section 10, "Client state").
 *
 * dirty -> debounce 1.5s -> PUT /api/canvases/:id { data, version }
 *   200  -> saved (version bumps)
 *   409  -> conflict: reload the canvas from GET, show "Updated in another tab"
 *   network failure or navigator.onLine === false -> offline, retry when back online
 *
 * The controller is framework free: it takes a small "port" with the store
 * operations it needs and injectable timers / fetch so it can be tested with
 * fake timers and a fake fetch.
 */
import { fetchCanvas, saveCanvas, type FetchLike } from "./client";
import type { CanvasData, CanvasDetail } from "./types";

export const AUTOSAVE_DEBOUNCE_MS = 1500;
export const OFFLINE_RETRY_MS = 5000;

export type SaveState = "saved" | "saving" | "offline" | "conflict";

export type AutosavePort = {
  /** Current document, version and change sequence number. */
  snapshot: () => { data: CanvasData; version: number; seq: number };
  isDirty: () => boolean;
  setSaveState: (state: SaveState) => void;
  /** Called after a 200. `seq` is the change sequence the save was taken at. */
  onSaved: (version: number, seq: number) => void;
  /** Called after a 409 once the fresh copy is loaded. */
  onConflict: (fresh: CanvasDetail | null) => void;
  /** Called when the canvas was deleted or access was lost. */
  onGone?: () => void;
};

export type AutosaveOptions = {
  debounceMs?: number;
  retryMs?: number;
  fetchImpl?: FetchLike;
  isOnline?: () => boolean;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
};

export type AutosaveController = {
  /** Call whenever the store becomes dirty. Debounced. */
  schedule: () => void;
  /** Skip the debounce and save now (e.g. before unload). Resolves when done. */
  flush: (options?: { keepalive?: boolean }) => Promise<void>;
  /** Call when the browser comes back online. */
  retry: () => void;
  dispose: () => void;
  readonly saving: boolean;
};

export function createAutosaveController(
  canvasId: string,
  port: AutosavePort,
  options: AutosaveOptions = {},
): AutosaveController {
  const debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
  const retryMs = options.retryMs ?? OFFLINE_RETRY_MS;
  const fetchImpl = options.fetchImpl;
  const isOnline = options.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const setT: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> =
    options.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT: (t: ReturnType<typeof setTimeout>) => void = options.clearTimeoutImpl ?? ((t) => clearTimeout(t));

  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let disposed = false;
  let queued = false;

  function clearTimer() {
    if (timer !== null) {
      clearT(timer);
      timer = null;
    }
  }

  async function save(saveOptions: { keepalive?: boolean } = {}): Promise<void> {
    if (disposed) return;
    if (inFlight) {
      queued = true;
      return inFlight;
    }
    if (!port.isDirty()) return;
    if (!isOnline()) {
      port.setSaveState("offline");
      clearTimer();
      timer = setT(() => {
        timer = null;
        void save();
      }, retryMs);
      return;
    }
    const { data, version, seq } = port.snapshot();
    port.setSaveState("saving");
    inFlight = (async () => {
      const result = await saveCanvas(canvasId, data, version, fetchImpl, saveOptions);
      if (disposed) return;
      switch (result.kind) {
        case "saved":
          port.onSaved(result.version, seq);
          break;
        case "conflict": {
          port.setSaveState("conflict");
          let fresh: CanvasDetail | null = null;
          try {
            fresh = await fetchCanvas(canvasId, fetchImpl);
          } catch {
            fresh = null;
          }
          if (!disposed) port.onConflict(fresh);
          break;
        }
        case "offline":
        case "error":
          port.setSaveState("offline");
          clearTimer();
          timer = setT(() => {
            timer = null;
            void save();
          }, retryMs);
          break;
        case "not_found":
        case "unauthorized":
          port.setSaveState("offline");
          port.onGone?.();
          break;
      }
    })();
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
    if (queued) {
      queued = false;
      if (port.isDirty()) schedule();
    }
  }

  function schedule() {
    if (disposed) return;
    clearTimer();
    timer = setT(() => {
      timer = null;
      void save();
    }, debounceMs);
  }

  return {
    schedule,
    flush: async (flushOptions) => {
      clearTimer();
      await save(flushOptions);
    },
    retry: () => {
      if (port.isDirty()) {
        clearTimer();
        void save();
      }
    },
    dispose: () => {
      disposed = true;
      clearTimer();
    },
    get saving() {
      return inFlight !== null;
    },
  };
}
