"use client";

import { useViewport } from "@xyflow/react";

import { useUiStore } from "@/store/ui-store";

/** Alignment guides drawn over the viewport while a node is dragged. */
export function HelperLines() {
  const lines = useUiStore((s) => s.helperLines);
  const { x, y, zoom } = useViewport();
  if (lines.horizontal === undefined && lines.vertical === undefined) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 z-[4] h-full w-full" aria-hidden>
      {lines.vertical !== undefined ? (
        <line x1={lines.vertical * zoom + x} x2={lines.vertical * zoom + x} y1={0} y2="100%" stroke="#f43f5e" strokeWidth={1} strokeDasharray="4 3" />
      ) : null}
      {lines.horizontal !== undefined ? (
        <line x1={0} x2="100%" y1={lines.horizontal * zoom + y} y2={lines.horizontal * zoom + y} stroke="#f43f5e" strokeWidth={1} strokeDasharray="4 3" />
      ) : null}
    </svg>
  );
}
