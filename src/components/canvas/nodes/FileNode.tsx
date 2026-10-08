"use client";

/**
 * Note card placeholder (spec 8.2, `type: "file"`). WP3 replaces the
 * internals (hover actions, refresh, open in Craft, duplicate badge, lazy
 * preview refresh) but keeps this file and its props contract:
 *
 *   props: NodeProps<FileFlowNode>
 *   props.data: { file: string; subpath?: string; color?: string; craftcanvas: FileNodeExtension }
 *   props.data.craftcanvas: { craftDocId, connectionId, title, folderPath?, preview?,
 *                            indexedAt?, missing?, updatedAt?, webUrl? }
 *
 * The card is 320 x 200 by default and resizable down to 160 x 80.
 */
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { FileText } from "lucide-react";
import { memo } from "react";

import { resolveColor, withAlpha } from "@/lib/canvas/colors";
import type { FileFlowNode } from "@/lib/canvas/convert";
import { MIN_SIZES } from "@/lib/canvas/types";
import { useCanvasStore } from "@/store/canvas-store";

import { MarkdownView } from "../MarkdownView";
import { NodeHandles } from "./NodeHandles";

export const FileNode = memo(function FileNode({ data, selected }: NodeProps<FileFlowNode>) {
  const beginBatch = useCanvasStore((s) => s.beginBatch);
  const { title, folderPath, preview, missing } = data.craftcanvas;
  const color = resolveColor(data.color);
  const style = color ? { borderColor: color, background: withAlpha(color, 0.1) } : undefined;

  return (
    <div className={`cc-card ${missing ? "opacity-60 grayscale" : ""}`} style={style}>
      <NodeResizer isVisible={selected} minWidth={MIN_SIZES.file.width} minHeight={MIN_SIZES.file.height} onResizeStart={() => beginBatch()} />
      <NodeHandles />
      <div className="flex h-full w-full flex-col gap-1 overflow-hidden p-3">
        <div className="flex items-start gap-2">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold" title={title}>
              {title || "Untitled"}
            </div>
            {folderPath ? (
              <div className="truncate text-[11px] text-zinc-500" title={folderPath}>
                {folderPath}
              </div>
            ) : null}
          </div>
        </div>
        {missing ? (
          <div className="text-xs text-zinc-500">Missing in Craft</div>
        ) : preview ? (
          <div className="min-h-0 flex-1 overflow-hidden text-zinc-700 dark:text-zinc-300">
            <MarkdownView text={preview} />
          </div>
        ) : (
          <div className="text-xs text-zinc-500">No preview yet</div>
        )}
      </div>
    </div>
  );
});
