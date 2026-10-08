"use client";

/**
 * Client root of `/canvas/[id]`: hydrates the canvas store from the server
 * loaded document, then renders the chrome (top bar with title and save
 * indicator, collapsible left panel, canvas, bottom toolbar) and runs the
 * autosave pipeline.
 */
import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { TopBar } from "@/components/app-shell/TopBar";
import { ReconnectBanner } from "@/components/notes-panel/ReconnectBanner";
import { useAutosave } from "@/hooks/useAutosave";
import { useCraftStatus, useStalePreviewRefresh } from "@/hooks/useCraftPreviews";
import type { CanvasDetail } from "@/lib/canvas/types";
import { useCanvasStore } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";

import { Canvas } from "./Canvas";
import { CanvasTitle } from "./CanvasTitle";
import { LeftPanel } from "./LeftPanel";
import { SaveIndicator } from "./SaveIndicator";
import { Toolbar } from "./Toolbar";

export function CanvasEditor({ canvas }: { canvas: CanvasDetail }) {
  const loaded = useSyncExternalStore(
    useCanvasStore.subscribe,
    () => useCanvasStore.getState().canvasId === canvas.id,
    () => false,
  );

  useEffect(() => {
    const store = useCanvasStore.getState();
    if (store.canvasId !== canvas.id) {
      useUiStore.getState().resetTransient();
      store.load({ id: canvas.id, title: canvas.title, version: canvas.version, data: canvas.data });
    }
  }, [canvas]);

  if (!loaded) {
    return (
      <div className="flex h-dvh flex-col">
        <TopBar />
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">Loading canvas…</div>
      </div>
    );
  }

  return <CanvasWorkspace canvasId={canvas.id} />;
}

function CanvasWorkspace({ canvasId }: { canvasId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const unauthorized = useUiStore((s) => s.craft.unauthorized);
  useAutosave(canvasId);
  useCraftStatus();
  useStalePreviewRefresh(canvasId);

  return (
    <ReactFlowProvider>
      <div className="flex h-dvh flex-col overflow-hidden">
        <TopBar trailing={<SaveIndicator />}>
          <CanvasTitle canvasId={canvasId} />
        </TopBar>
        {unauthorized ? (
          <div className="border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950" data-reconnect-banner>
            <ReconnectBanner message="Your Craft connection stopped working. Note cards keep their last preview until you reconnect." />
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1">
          <LeftPanel canvasId={canvasId} />
          <div className="relative min-w-0 flex-1">
            <Canvas containerRef={containerRef} />
            <Toolbar containerRef={containerRef} />
          </div>
        </div>
      </div>
    </ReactFlowProvider>
  );
}
