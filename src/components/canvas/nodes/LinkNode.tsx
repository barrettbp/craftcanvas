"use client";

/**
 * Link card. Deferred to v1.x in the spec, but the type is kept so exports and
 * imports round trip. Renders the URL as a clickable card.
 */
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { Link as LinkIcon } from "lucide-react";
import { memo } from "react";

import { resolveColor, withAlpha } from "@/lib/canvas/colors";
import type { LinkFlowNode } from "@/lib/canvas/convert";
import { MIN_SIZES } from "@/lib/canvas/types";
import { useCanvasStore } from "@/store/canvas-store";

import { NodeHandles } from "./NodeHandles";

export const LinkNode = memo(function LinkNode({ data, selected }: NodeProps<LinkFlowNode>) {
  const beginBatch = useCanvasStore((s) => s.beginBatch);
  const color = resolveColor(data.color);
  const style = color ? { borderColor: color, background: withAlpha(color, 0.1) } : undefined;
  return (
    <div className="cc-card" style={style}>
      <NodeResizer isVisible={selected} minWidth={MIN_SIZES.link.width} minHeight={MIN_SIZES.link.height} onResizeStart={() => beginBatch()} />
      <NodeHandles />
      <div className="flex h-full items-center gap-2 overflow-hidden p-3">
        <LinkIcon className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
        <a href={data.url} target="_blank" rel="noreferrer noopener" className="nodrag truncate text-sm underline">
          {data.url}
        </a>
      </div>
    </div>
  );
});
