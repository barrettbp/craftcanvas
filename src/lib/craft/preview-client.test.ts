import { describe, expect, it } from "vitest";

import type { FileNodeExtension } from "@/lib/canvas/types";

import { createPreviewQueue, isStale, mergePreview, PREVIEW_STALE_MS, type PreviewOutcome } from "./preview-client";
import type { PreviewResponse } from "./types";

const NOW = Date.parse("2026-03-01T12:00:00Z");

describe("isStale", () => {
  it("treats a missing or unparsable timestamp as stale", () => {
    expect(isStale(undefined, NOW)).toBe(true);
    expect(isStale(null, NOW)).toBe(true);
    expect(isStale("", NOW)).toBe(true);
    expect(isStale("not a date", NOW)).toBe(true);
  });

  it("is fresh under 24 hours and stale from 24 hours on", () => {
    expect(isStale(new Date(NOW - 60_000).toISOString(), NOW)).toBe(false);
    expect(isStale(new Date(NOW - PREVIEW_STALE_MS + 1).toISOString(), NOW)).toBe(false);
    expect(isStale(new Date(NOW - PREVIEW_STALE_MS).toISOString(), NOW)).toBe(true);
    expect(isStale(new Date(NOW - 3 * PREVIEW_STALE_MS).toISOString(), NOW)).toBe(true);
  });

  it("is not fooled by a timestamp in the future", () => {
    expect(isStale(new Date(NOW + 60_000).toISOString(), NOW)).toBe(false);
  });
});

function deferredFetcher() {
  const pending = new Map<string, (outcome: PreviewOutcome) => void>();
  const started: string[] = [];
  const fetcher = (docId: string) =>
    new Promise<PreviewOutcome>((resolve) => {
      started.push(docId);
      pending.set(docId, resolve);
    });
  const resolve = (docId: string, outcome?: PreviewOutcome) => {
    const fn = pending.get(docId);
    if (!fn) throw new Error(`not started: ${docId}`);
    pending.delete(docId);
    fn(outcome ?? { ok: true, data: response(docId) });
  };
  return { fetcher, started, resolve };
}

function response(docId: string, extra: Partial<PreviewResponse> = {}): PreviewResponse {
  return { craftDocId: docId, title: `Doc ${docId}`, folderPath: "A/B", preview: `# ${docId}`, updatedAt: null, indexedAt: "2026-03-01T00:00:00Z", missing: false, ...extra };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("createPreviewQueue", () => {
  it("keeps at most the limit in flight and starts the rest as slots free up", async () => {
    const { fetcher, started, resolve } = deferredFetcher();
    const queue = createPreviewQueue(fetcher, 4);
    const ids = ["a", "b", "c", "d", "e", "f"];
    const promises = ids.map((id) => queue.enqueue(id));

    expect(started).toEqual(["a", "b", "c", "d"]);
    expect(queue.active).toBe(4);
    expect(queue.pending).toBe(2);

    resolve("b");
    await tick();
    expect(started).toEqual(["a", "b", "c", "d", "e"]);
    expect(queue.active).toBe(4);
    expect(queue.pending).toBe(1);

    resolve("a");
    resolve("c");
    await tick();
    expect(started).toEqual(ids);
    expect(queue.active).toBe(3);
    expect(queue.pending).toBe(0);

    resolve("d");
    resolve("e");
    resolve("f");
    const outcomes = await Promise.all(promises);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(outcomes.map((o) => (o.ok ? o.data.craftDocId : ""))).toEqual(ids);
    expect(queue.active).toBe(0);
    expect(queue.pending).toBe(0);
  });

  it("collapses concurrent requests for the same document into one fetch", async () => {
    const { fetcher, started, resolve } = deferredFetcher();
    const queue = createPreviewQueue(fetcher, 4);
    const first = queue.enqueue("x");
    const second = queue.enqueue("x");
    expect(first).toBe(second);
    expect(queue.has("x")).toBe(true);
    expect(started).toEqual(["x"]);

    resolve("x");
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(queue.has("x")).toBe(false);

    // Once settled a new request goes out again.
    void queue.enqueue("x");
    expect(started).toEqual(["x", "x"]);
    resolve("x");
  });

  it("turns a throwing fetcher into a failed outcome and frees the slot", async () => {
    const queue = createPreviewQueue(async (id) => {
      if (id === "bad") throw new Error("boom");
      return { ok: true, data: response(id) };
    }, 1);
    const bad = await queue.enqueue("bad");
    expect(bad).toEqual({ ok: false, status: 0, error: "boom" });
    expect(queue.active).toBe(0);
    const good = await queue.enqueue("good");
    expect(good.ok).toBe(true);
  });
});

describe("mergePreview", () => {
  const ext: FileNodeExtension = { craftDocId: "d1", connectionId: "c1", title: "Old", folderPath: "Old/Path", preview: "old preview" };

  it("copies the fresh fields from the response", () => {
    const merged = mergePreview(ext, response("d1", { updatedAt: "2026-02-01T00:00:00Z", webUrl: "https://craft.example/d1" }));
    expect(merged).toEqual({
      craftDocId: "d1",
      connectionId: "c1",
      title: "Doc d1",
      folderPath: "A/B",
      preview: "# d1",
      indexedAt: "2026-03-01T00:00:00Z",
      missing: false,
      updatedAt: "2026-02-01T00:00:00Z",
      webUrl: "https://craft.example/d1",
    });
  });

  it("keeps the last preview and title when the document went missing", () => {
    const merged = mergePreview(ext, response("d1", { title: "", folderPath: "", preview: "", missing: true }));
    expect(merged.missing).toBe(true);
    expect(merged.preview).toBe("old preview");
    expect(merged.title).toBe("Old");
    expect(merged.folderPath).toBe("Old/Path");
    expect(merged.indexedAt).toBe("2026-03-01T00:00:00Z");
  });

  it("accepts an empty preview for a present document", () => {
    const merged = mergePreview(ext, response("d1", { preview: "" }));
    expect(merged.preview).toBe("");
    expect(merged.missing).toBe(false);
  });
});
