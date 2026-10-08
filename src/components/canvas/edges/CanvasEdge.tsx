"use client";

/**
 * Arrow (spec 8.3): smooth bezier, arrow heads per `fromEnd` / `toEnd`
 * (markers are set on the edge object by `decorateEdge`), optional label that
 * is edited inline on double click.
 */
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { memo, useState } from "react";

import { NEUTRAL_STROKE, resolveColor } from "@/lib/canvas/colors";
import type { FlowEdge } from "@/lib/canvas/convert";
import { useCanvasStore } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";

export const CanvasEdge = memo(function CanvasEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerStart,
  markerEnd,
}: EdgeProps<FlowEdge>) {
  const editing = useUiStore((s) => s.editingEdgeId === id);
  const setEditingEdge = useUiStore((s) => s.setEditingEdge);
  const setEdgeLabel = useCanvasStore((s) => s.setEdgeLabel);
  const breakCoalescing = useCanvasStore((s) => s.breakCoalescing);
  const [draft, setDraft] = useState<string | null>(null);

  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const color = resolveColor(data?.color) ?? NEUTRAL_STROKE;
  const label = data?.label ?? "";

  const commit = () => {
    if (draft !== null) setEdgeLabel(id, draft.trim());
    setDraft(null);
    breakCoalescing();
    setEditingEdge(null);
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={18}
        style={{ stroke: color, strokeWidth: selected ? 3 : 2 }}
      />
      {editing || label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all" }}
          >
            {editing ? (
              <input
                className="cc-edge-label outline-none ring-2 ring-blue-500"
                autoFocus
                value={draft ?? label}
                placeholder="Label"
                size={Math.max(6, (draft ?? label).length + 2)}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setDraft(null);
                    setEditingEdge(null);
                  }
                  e.stopPropagation();
                }}
              />
            ) : (
              <div
                className="cc-edge-label cursor-text"
                style={selected ? { borderColor: color } : undefined}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingEdge(id);
                }}
              >
                {label}
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});
