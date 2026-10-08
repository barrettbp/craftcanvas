"use client";

/**
 * Wires the autosave controller (`@/lib/canvas/autosave`) to the canvas store:
 * every change bumps `changeSeq`, which schedules a debounced PUT. Online /
 * offline events retry, and the pending save is flushed when the tab is
 * hidden or closed.
 */
import { useEffect } from "react";

import { createAutosaveController } from "@/lib/canvas/autosave";
import { useCanvasStore } from "@/store/canvas-store";

export function useAutosave(canvasId: string) {
  useEffect(() => {
    const store = useCanvasStore;
    const controller = createAutosaveController(canvasId, {
      snapshot: () => {
        const s = store.getState();
        return { data: s.getCanvasData(), version: s.version, seq: s.changeSeq };
      },
      isDirty: () => store.getState().dirty && store.getState().canvasId === canvasId,
      setSaveState: (state) => store.getState().setSaveState(state),
      onSaved: (version, seq) => store.getState().markSaved(version, seq),
      onConflict: (fresh) => {
        if (fresh && store.getState().canvasId === canvasId) store.getState().replaceFromServer(fresh);
      },
    });

    const unsubscribe = store.subscribe((state, prev) => {
      if (state.canvasId !== canvasId) return;
      if (state.changeSeq !== prev.changeSeq && state.dirty) controller.schedule();
    });

    const onOnline = () => controller.retry();
    const onOffline = () => {
      if (store.getState().dirty) store.getState().setSaveState("offline");
    };
    // Tab hidden or closing: send the pending save with keepalive so it
    // completes even if the page goes away. No "leave site?" prompt; the
    // request survives navigation on its own.
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && store.getState().dirty) void controller.flush({ keepalive: true });
    };
    const onBeforeUnload = () => {
      if (store.getState().dirty) void controller.flush({ keepalive: true });
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);

    // A change may have landed before this effect ran.
    if (store.getState().dirty && store.getState().canvasId === canvasId) controller.schedule();

    return () => {
      unsubscribe();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (store.getState().dirty && store.getState().canvasId === canvasId) void controller.flush({ keepalive: true });
      controller.dispose();
    };
  }, [canvasId]);
}
