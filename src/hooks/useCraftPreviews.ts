"use client";

/**
 * Glue between the preview queue (`@/lib/craft/preview-client`), the canvas
 * store and the UI store (spec section 7 "Document index" and "Error
 * handling"):
 *
 * - `refreshPreview(docId)` fetches `/api/craft/preview/:id` through the
 *   shared four wide queue and writes the result into every card showing the
 *   document. A 403 `craft_unauthorized` raises the reconnect banner; a 404
 *   `not_connected` stays quiet; a 404 `not_found` marks the cards missing.
 * - `addCraftDocument(doc, position)` creates the card and queues its preview.
 * - `useCraftStatus()` polls `/api/craft/status` once per mount so the canvas
 *   page knows the connection id, the space id and whether the key still works.
 * - `useStalePreviewRefresh(canvasId)` refreshes cards whose `indexedAt` is
 *   missing or older than 24 hours when a canvas opens.
 */
import { useEffect } from "react";

import type { FileNodeData } from "@/lib/canvas/convert";
import { docToFileExtension } from "@/lib/canvas/drop";
import { isStale, mergePreview, previewQueue } from "@/lib/craft/preview-client";
import type { CraftDocDragPayload, CraftStatusResponse } from "@/lib/craft/types";
import { useCanvasStore } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";

function fileNodesFor(docId: string) {
  return useCanvasStore.getState().nodes.filter((n) => n.type === "file" && (n.data as FileNodeData).craftcanvas.craftDocId === docId);
}

/** Refreshes one document's preview on every card that shows it. */
export async function refreshPreview(docId: string, options: { force?: boolean } = {}): Promise<void> {
  const ui = useUiStore.getState();
  if (!options.force && previewQueue.has(docId)) return;
  if (fileNodesFor(docId).length === 0) return;
  ui.setPreviewLoading(docId, true);
  try {
    const outcome = await previewQueue.enqueue(docId);
    const store = useCanvasStore.getState();
    if (outcome.ok) {
      if (outcome.data.craftDocId && outcome.data.craftDocId !== docId) return;
      for (const node of fileNodesFor(docId)) {
        const data = node.data as FileNodeData;
        store.updateNodeData(node.id, { craftcanvas: mergePreview(data.craftcanvas, outcome.data) }, { history: false });
      }
      if (useUiStore.getState().craft.unauthorized) useUiStore.getState().setCraftStatus({ unauthorized: false });
      return;
    }
    if (outcome.status === 403 && outcome.error === "craft_unauthorized") {
      useUiStore.getState().setCraftStatus({ unauthorized: true });
    } else if (outcome.status === 404 && outcome.error === "not_found") {
      for (const node of fileNodesFor(docId)) {
        const data = node.data as FileNodeData;
        if (data.craftcanvas.missing) continue;
        store.updateNodeData(node.id, { craftcanvas: { ...data.craftcanvas, missing: true } }, { history: false });
      }
    }
    // not_connected, rate limits and network errors: keep the last preview quietly.
  } finally {
    useUiStore.getState().setPreviewLoading(docId, false);
  }
}

/** Creates a note card at `position` (flow coordinates) and queues its preview. */
export function addCraftDocument(doc: CraftDocDragPayload, position: { x: number; y: number }): string {
  const connectionId = useUiStore.getState().craft.connectionId ?? "";
  const id = useCanvasStore.getState().addFileNode(docToFileExtension(doc, connectionId), position);
  void refreshPreview(doc.craftDocId);
  return id;
}

/** Loads `/api/craft/status` once and stores the parts the canvas page needs. */
export function useCraftStatus(): void {
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/craft/status", { signal: controller.signal, cache: "no-store" });
        if (!res.ok) return;
        const status = (await res.json()) as CraftStatusResponse;
        if (controller.signal.aborted) return;
        useUiStore.getState().setCraftStatus({
          connectionId: status.connected ? (status.connectionId ?? null) : null,
          spaceId: status.connected ? (status.spaceId ?? null) : null,
          unauthorized: status.connected && status.status === "unauthorized",
        });
      } catch {
        // Offline or aborted: the canvas works from its saved state.
      }
    })();
    return () => controller.abort();
  }, []);
}

/** Refreshes stale cards once per canvas open (lazily, four at a time). */
export function useStalePreviewRefresh(canvasId: string): void {
  useEffect(() => {
    const state = useCanvasStore.getState();
    if (state.canvasId !== canvasId) return;
    const now = Date.now();
    const seen = new Set<string>();
    for (const node of state.nodes) {
      if (node.type !== "file") continue;
      const ext = (node.data as FileNodeData).craftcanvas;
      if (seen.has(ext.craftDocId) || !isStale(ext.indexedAt, now)) continue;
      seen.add(ext.craftDocId);
      void refreshPreview(ext.craftDocId);
    }
  }, [canvasId]);
}
