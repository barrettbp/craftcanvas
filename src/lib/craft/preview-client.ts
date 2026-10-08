/**
 * Browser side of `/api/craft/preview/:docId` (spec section 7 "Document
 * index", per card refresh). Pure helpers live here so they can be unit
 * tested; nothing in this module touches React or the stores.
 *
 * - `isStale(indexedAt, now)` decides whether a card needs a refresh when a
 *   canvas opens (missing or older than 24 hours).
 * - `createPreviewQueue(fetcher, limit)` runs preview fetches with at most
 *   `limit` in flight and collapses concurrent requests for the same document
 *   into one call.
 * - `fetchPreview(docId)` is the raw request, mapped to a `PreviewOutcome` so
 *   callers never have to catch.
 */
import type { FileNodeExtension } from "@/lib/canvas/types";

import type { PreviewResponse } from "./types";

export const PREVIEW_STALE_MS = 24 * 60 * 60 * 1000;
export const PREVIEW_CONCURRENCY = 4;

export type PreviewOutcome =
  | { ok: true; data: PreviewResponse }
  | {
      ok: false;
      /** HTTP status, or 0 for a network failure. */
      status: number;
      /** Error vocabulary from `@/lib/craft/api` ("craft_unauthorized", "not_connected", ...) or "network". */
      error: string;
      /** Seconds to wait, when the route answered 429. */
      retryAfter?: number;
    };

/** True when `indexedAt` is missing, unparsable or at least 24 hours before `now`. */
export function isStale(indexedAt: string | null | undefined, now: number = Date.now(), maxAgeMs: number = PREVIEW_STALE_MS): boolean {
  if (!indexedAt) return true;
  const t = Date.parse(indexedAt);
  if (Number.isNaN(t)) return true;
  return now - t >= maxAgeMs;
}

/**
 * Merges a preview response into a card's extension block. A document that
 * went missing keeps its last preview so the card still shows something
 * (spec section 7 "Error handling").
 */
export function mergePreview(ext: FileNodeExtension, data: PreviewResponse): FileNodeExtension {
  const next: FileNodeExtension = {
    ...ext,
    title: data.title || ext.title,
    folderPath: data.folderPath || ext.folderPath,
    indexedAt: data.indexedAt,
    missing: data.missing,
  };
  if (data.preview || !data.missing) next.preview = data.preview;
  if (data.updatedAt) next.updatedAt = data.updatedAt;
  if (data.webUrl) next.webUrl = data.webUrl;
  if (next.folderPath === undefined) delete next.folderPath;
  return next;
}

export async function fetchPreview(docId: string, signal?: AbortSignal): Promise<PreviewOutcome> {
  try {
    const res = await fetch(`/api/craft/preview/${encodeURIComponent(docId)}`, { signal, cache: "no-store" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string; retryAfter?: number } | null;
      const retryAfter = body?.retryAfter ?? (Number(res.headers.get("Retry-After")) || undefined);
      return { ok: false, status: res.status, error: body?.error ?? `http_${res.status}`, ...(retryAfter ? { retryAfter } : {}) };
    }
    return { ok: true, data: (await res.json()) as PreviewResponse };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return { ok: false, status: 0, error: "aborted" };
    return { ok: false, status: 0, error: "network" };
  }
}

export type PreviewQueue = {
  /** Fetches the preview, waiting for a free slot. Concurrent calls for one doc share a request. */
  enqueue: (docId: string) => Promise<PreviewOutcome>;
  /** True while a request for the document is queued or in flight. */
  has: (docId: string) => boolean;
  readonly active: number;
  readonly pending: number;
};

export function createPreviewQueue(fetcher: (docId: string) => Promise<PreviewOutcome> = fetchPreview, limit = PREVIEW_CONCURRENCY): PreviewQueue {
  const inFlight = new Map<string, Promise<PreviewOutcome>>();
  const waiting: Array<() => void> = [];
  let active = 0;

  const next = () => {
    active -= 1;
    const start = waiting.shift();
    if (start) start();
  };

  const run = (docId: string) =>
    new Promise<PreviewOutcome>((resolve) => {
      const start = () => {
        active += 1;
        fetcher(docId).then(
          (outcome) => {
            next();
            resolve(outcome);
          },
          (error) => {
            next();
            resolve({ ok: false, status: 0, error: error instanceof Error ? error.message : "network" });
          },
        );
      };
      if (active < limit) start();
      else waiting.push(start);
    });

  return {
    enqueue(docId) {
      const existing = inFlight.get(docId);
      if (existing) return existing;
      const promise = run(docId).finally(() => {
        inFlight.delete(docId);
      });
      inFlight.set(docId, promise);
      return promise;
    },
    has: (docId) => inFlight.has(docId),
    get active() {
      return active;
    },
    get pending() {
      return waiting.length;
    },
  };
}

/** Shared queue for the canvas page: at most four preview requests in flight. */
export const previewQueue: PreviewQueue = createPreviewQueue();
