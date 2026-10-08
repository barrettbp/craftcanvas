"use client";

/**
 * Text card (spec 8.2). Renders markdown; double click or Enter edits in a
 * plain textarea. Height follows the content until the user resizes the card
 * by hand (`data.manualSize`), after which it is fixed.
 */
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { memo, useEffect, useRef } from "react";

import { resolveColor, withAlpha } from "@/lib/canvas/colors";
import type { TextFlowNode } from "@/lib/canvas/convert";
import { MIN_SIZES } from "@/lib/canvas/types";
import { useCanvasStore } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";

import { MarkdownView } from "../MarkdownView";
import { NodeHandles } from "./NodeHandles";

export const TextNode = memo(function TextNode({ id, data, selected }: NodeProps<TextFlowNode>) {
  const editing = useUiStore((s) => s.editingNodeId === id);
  const setEditingNode = useUiStore((s) => s.setEditingNode);
  const setNodeText = useCanvasStore((s) => s.setNodeText);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const breakCoalescing = useCanvasStore((s) => s.breakCoalescing);
  const beginBatch = useCanvasStore((s) => s.beginBatch);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const color = resolveColor(data.color);
  const style = color ? { borderColor: color, background: withAlpha(color, 0.1) } : undefined;

  // Auto grow the textarea with its content while editing.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!data.manualSize) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [data.text, data.manualSize, editing]);

  const stopEditing = () => {
    breakCoalescing();
    setEditingNode(null);
  };

  return (
    <div
      className={`cc-card ${data.manualSize ? "" : "cc-card--auto"}`}
      style={style}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditingNode(id);
      }}
    >
      <NodeResizer
        isVisible={selected && !editing}
        minWidth={MIN_SIZES.text.width}
        minHeight={MIN_SIZES.text.height}
        onResizeStart={() => {
          beginBatch();
          if (!data.manualSize) updateNodeData(id, { manualSize: true });
        }}
      />
      <NodeHandles />
      <div className="h-full w-full overflow-hidden p-3" style={data.manualSize ? undefined : { minHeight: MIN_SIZES.text.height }}>
        {editing ? (
          <textarea
            ref={textareaRef}
            className="cc-textarea nodrag nowheel nopan"
            autoFocus
            value={data.text}
            placeholder="Write markdown…"
            onChange={(e) => setNodeText(id, e.target.value)}
            onBlur={stopEditing}
            onKeyDown={(e) => {
              if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
                e.preventDefault();
                stopEditing();
              }
              e.stopPropagation();
            }}
            style={data.manualSize ? { height: "100%", overflow: "auto" } : { overflow: "hidden" }}
          />
        ) : data.text.trim() ? (
          <MarkdownView text={data.text} />
        ) : (
          <span className="cc-placeholder">Double click to write</span>
        )}
      </div>
    </div>
  );
});
