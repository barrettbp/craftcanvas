"use client";

/**
 * Group (spec 8.2): a labelled rectangle behind other nodes. Nodes fully
 * inside move with it (React Flow `parentId`, assigned in convert.ts). The
 * label is editable inline; the colour is drawn at low opacity.
 */
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { memo, useState } from "react";

import { NEUTRAL_STROKE, resolveColor, withAlpha } from "@/lib/canvas/colors";
import type { GroupFlowNode } from "@/lib/canvas/convert";
import { MIN_SIZES } from "@/lib/canvas/types";
import { useCanvasStore } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";

import { NodeHandles } from "./NodeHandles";

export const GroupNode = memo(function GroupNode({ id, data, selected }: NodeProps<GroupFlowNode>) {
  const editing = useUiStore((s) => s.editingNodeId === id);
  const setEditingNode = useUiStore((s) => s.setEditingNode);
  const setGroupLabel = useCanvasStore((s) => s.setGroupLabel);
  const breakCoalescing = useCanvasStore((s) => s.breakCoalescing);
  const beginBatch = useCanvasStore((s) => s.beginBatch);
  const reparentNodes = useCanvasStore((s) => s.reparentNodes);
  const [draft, setDraft] = useState<string | null>(null);

  const color = resolveColor(data.color) ?? NEUTRAL_STROKE;
  const label = data.label ?? "";

  const commit = () => {
    if (draft !== null) setGroupLabel(id, draft.trim());
    setDraft(null);
    breakCoalescing();
    setEditingNode(null);
  };

  return (
    <div className="cc-group" style={{ borderColor: withAlpha(color, 0.6), background: withAlpha(color, 0.08) }}>
      <NodeResizer
        isVisible={selected && !editing}
        minWidth={MIN_SIZES.group.width}
        minHeight={MIN_SIZES.group.height}
        onResizeStart={() => beginBatch()}
        onResizeEnd={() => reparentNodes()}
      />
      <NodeHandles />
      {editing ? (
        <input
          className="cc-group__label nodrag nopan rounded border border-current bg-transparent px-1 outline-none"
          style={{ top: 4, left: 8 }}
          autoFocus
          value={draft ?? label}
          placeholder="Group name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(null);
              setEditingNode(null);
            }
            e.stopPropagation();
          }}
        />
      ) : (
        <div
          className="cc-group__label"
          title={label}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditingNode(id);
          }}
        >
          {label || <span className="cc-placeholder">Group</span>}
        </div>
      )}
    </div>
  );
});
