"use client";

/**
 * Thumbnails on save (spec 8.7). Listens for the autosave success path (the
 * store's `lastSavedAt` only moves in `markSaved`, after a 200), throttles to
 * one capture per 30s per canvas, renders a small PNG of the viewport and
 * POSTs it to `/api/canvases/:id/thumbnail`. Everything is best effort: a
 * failed capture or upload is simply retried on a later save.
 */
import { useEffect, type RefObject } from "react";

import { canvasBackground, contentBounds, findViewportElement } from "@/lib/export/capture";
import { fitsThumbnailLimit, postThumbnail, renderThumbnail } from "@/lib/export/thumbnail";
import { createThumbnailScheduler } from "@/lib/export/thumbnail-scheduler";
import { useCanvasStore } from "@/store/canvas-store";

/** Last capture per canvas, so leaving and reopening a canvas keeps the 30s window. */
const lastCaptureAt = new Map<string, number>();

export function useThumbnail(canvasId: string, containerRef?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const store = useCanvasStore;
    let inFlight = false;

    const capture = async () => {
      if (inFlight) return;
      const state = store.getState();
      if (state.canvasId !== canvasId) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const element = findViewportElement(containerRef?.current ?? document);
      if (!element) return;
      const bounds = contentBounds(state.nodes);
      if (!bounds) return;
      inFlight = true;
      try {
        const dataUrl = await renderThumbnail({ element, nodesBounds: bounds, background: canvasBackground(element) });
        if (!fitsThumbnailLimit(dataUrl)) return;
        if (store.getState().canvasId !== canvasId) return;
        await postThumbnail(canvasId, dataUrl);
      } catch {
        // Best effort; the next save tries again.
      } finally {
        inFlight = false;
      }
    };

    const scheduler = createThumbnailScheduler(() => void capture(), { lastRunAt: lastCaptureAt.get(canvasId) ?? null });

    const unsubscribe = store.subscribe((state, prev) => {
      if (state.canvasId !== canvasId) return;
      if (state.lastSavedAt !== null && state.lastSavedAt !== prev.lastSavedAt) scheduler.notify();
    });

    return () => {
      unsubscribe();
      if (scheduler.lastRunAt !== null) lastCaptureAt.set(canvasId, scheduler.lastRunAt);
      scheduler.dispose();
    };
  }, [canvasId, containerRef]);
}
