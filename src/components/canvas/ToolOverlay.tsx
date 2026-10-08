"use client";

/**
 * Placement overlay for the toolbar tools: click to place a text card, or
 * drag a rectangle to draw a group (click for a default sized one).
 */
import { useReactFlow } from "@xyflow/react";
import { useState } from "react";

import { snapToGrid } from "@/lib/canvas/geometry";
import { DEFAULT_SIZES, GRID_SIZE } from "@/lib/canvas/types";
import { useCanvasStore } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";

type Drag = { startClient: { x: number; y: number }; current: { x: number; y: number }; origin: { left: number; top: number } };

export function ToolOverlay() {
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const setEditingNode = useUiStore((s) => s.setEditingNode);
  const rf = useReactFlow();
  const [drag, setDrag] = useState<Drag | null>(null);

  if (tool === "select") return null;

  const snap = (v: number) => (useCanvasStore.getState().grid ? snapToGrid(v, GRID_SIZE) : v);

  const finish = (clientStart: { x: number; y: number }, clientEnd: { x: number; y: number }) => {
    const store = useCanvasStore.getState();
    const a = rf.screenToFlowPosition(clientStart);
    const b = rf.screenToFlowPosition(clientEnd);
    if (tool === "text") {
      const size = DEFAULT_SIZES.text;
      const id = store.addTextNode({ x: snap(a.x - size.width / 2), y: snap(a.y - size.height / 2) });
      setEditingNode(id);
    } else {
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      const rect =
        w > 10 && h > 10
          ? { x: snap(Math.min(a.x, b.x)), y: snap(Math.min(a.y, b.y)), width: snap(w), height: snap(h) }
          : { x: snap(a.x), y: snap(a.y), ...DEFAULT_SIZES.group };
      const id = store.addGroupNode(rect);
      setEditingNode(id);
    }
    setTool("select");
  };

  const rectStyle = drag
    ? {
        left: Math.min(drag.startClient.x, drag.current.x) - drag.origin.left,
        top: Math.min(drag.startClient.y, drag.current.y) - drag.origin.top,
        width: Math.abs(drag.current.x - drag.startClient.x),
        height: Math.abs(drag.current.y - drag.startClient.y),
      }
    : null;

  return (
    <div
      className={`absolute inset-0 z-20 ${tool === "text" ? "cursor-text" : "cursor-crosshair"}`}
      data-tool-overlay
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const origin = e.currentTarget.getBoundingClientRect();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ startClient: { x: e.clientX, y: e.clientY }, current: { x: e.clientX, y: e.clientY }, origin: { left: origin.left, top: origin.top } });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        setDrag({ ...drag, current: { x: e.clientX, y: e.clientY } });
      }}
      onPointerUp={(e) => {
        if (!drag) return;
        setDrag(null);
        finish(drag.startClient, { x: e.clientX, y: e.clientY });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setDrag(null);
        setTool("select");
      }}
    >
      <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-zinc-900/90 px-3 py-1 text-xs text-white shadow dark:bg-zinc-100/90 dark:text-zinc-900">
        {tool === "text" ? "Click to place a text card" : "Drag to draw a group, click for a default one"} · Esc to cancel
      </div>
      {rectStyle && tool === "group" ? (
        <div className="pointer-events-none absolute rounded-md border-2 border-dashed border-blue-500 bg-blue-500/10" style={rectStyle} />
      ) : null}
    </div>
  );
}
