"use client";

/**
 * Collapsible left panel (`[` toggles). Width is remembered per browser in
 * localStorage. Renders the notes panel slot that WP3 fills.
 */
import { useState } from "react";

import { useLocalStorageValue } from "@/hooks/useLocalStorage";
import { useUiStore } from "@/store/ui-store";

import { NotesPanelSlot } from "./NotesPanelSlot";

const MIN_WIDTH = 200;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 280;
export const PANEL_WIDTH_KEY = "craftcanvas.panelWidth";

function clamp(v: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, v));
}

export function LeftPanel({ canvasId }: { canvasId: string }) {
  const open = useUiStore((s) => s.panelOpen);
  const [storedWidth, setStoredWidth] = useLocalStorageValue<number>(PANEL_WIDTH_KEY, DEFAULT_WIDTH);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const width = clamp(dragWidth ?? (typeof storedWidth === "number" ? storedWidth : DEFAULT_WIDTH));

  if (!open) return null;

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
      style={{ width }}
      aria-label="Notes panel"
    >
      <NotesPanelSlot canvasId={canvasId} />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize notes panel"
        className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-blue-500/30"
        onPointerDown={(e) => {
          e.preventDefault();
          const aside = e.currentTarget.parentElement;
          if (!aside) return;
          const left = aside.getBoundingClientRect().left;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragWidth(clamp(e.clientX - left));
          const target = e.currentTarget;
          const onMove = (ev: PointerEvent) => setDragWidth(clamp(ev.clientX - left));
          const onUp = (ev: PointerEvent) => {
            target.removeEventListener("pointermove", onMove);
            target.removeEventListener("pointerup", onUp);
            const finalWidth = clamp(ev.clientX - left);
            setStoredWidth(finalWidth);
            setDragWidth(null);
          };
          target.addEventListener("pointermove", onMove);
          target.addEventListener("pointerup", onUp);
        }}
      />
    </aside>
  );
}
