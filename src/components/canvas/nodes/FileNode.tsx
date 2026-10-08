"use client";

/**
 * Note card (spec 8.2, `type: "file"`): title, folder path, markdown preview
 * clipped to the card, hover actions (Open in Craft, Refresh, Colour, Remove),
 * double click to open in Craft, a count badge when the same document sits on
 * the canvas more than once, a grey "Missing in Craft" state and a shimmer
 * while the preview loads.
 *
 *   props: NodeProps<FileFlowNode>
 *   props.data: { file: string; subpath?: string; color?: string; craftcanvas: FileNodeExtension }
 *
 * The card is 320 x 200 by default and resizable down to 160 x 80.
 */
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { ExternalLink, FileText, LoaderCircle, Palette, RefreshCw, Trash2 } from "lucide-react";
import { memo, useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";

import { refreshPreview } from "@/hooks/useCraftPreviews";
import { resolveColor, withAlpha } from "@/lib/canvas/colors";
import type { FileFlowNode } from "@/lib/canvas/convert";
import { MIN_SIZES } from "@/lib/canvas/types";
import { openInCraft } from "@/lib/craft/deep-link";
import { selectDocCount, useCanvasStore } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";

import { ColorPicker } from "../ColorPicker";
import { MarkdownView } from "../MarkdownView";
import { NodeHandles } from "./NodeHandles";

const HINT_MS = 6000;

type Hint = { text: string; webUrl?: string | null };

function ActionButton({
  label,
  onClick,
  danger,
  active,
  children,
}: {
  label: string;
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  danger?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={`flex h-6 w-6 items-center justify-center rounded ${
        danger
          ? "text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
          : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      } ${active ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100" : ""}`}
    >
      {children}
    </button>
  );
}

function Shimmer() {
  return (
    <div className="cc-shimmer animate-pulse space-y-2" aria-label="Loading preview" role="status">
      <div className="h-2.5 w-11/12 rounded bg-zinc-200 dark:bg-zinc-700" />
      <div className="h-2.5 w-full rounded bg-zinc-200 dark:bg-zinc-700" />
      <div className="h-2.5 w-4/5 rounded bg-zinc-200 dark:bg-zinc-700" />
      <div className="h-2.5 w-2/3 rounded bg-zinc-200 dark:bg-zinc-700" />
    </div>
  );
}

export const FileNode = memo(function FileNode({ id, data, selected }: NodeProps<FileFlowNode>) {
  const beginBatch = useCanvasStore((s) => s.beginBatch);
  const setNodesColor = useCanvasStore((s) => s.setNodesColor);
  const removeNodes = useCanvasStore((s) => s.removeNodes);
  const { craftDocId, title, folderPath, preview, missing, webUrl } = data.craftcanvas;
  const count = useCanvasStore((s) => selectDocCount(s, craftDocId));
  const loading = useUiStore((s) => s.loadingPreviews[craftDocId] === true);
  const spaceId = useUiStore((s) => s.craft.spaceId);
  const [colorOpen, setColorOpen] = useState(false);
  const [hint, setHint] = useState<Hint | null>(null);

  const color = resolveColor(data.color);
  const style = color ? { borderColor: color, background: withAlpha(color, 0.1) } : undefined;

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(null), HINT_MS);
    return () => window.clearTimeout(timer);
  }, [hint]);

  // Close the colour popover when the card loses its selection.
  const [wasSelected, setWasSelected] = useState(selected);
  if (wasSelected !== selected) {
    setWasSelected(selected);
    if (!selected) setColorOpen(false);
  }

  const open = useCallback(() => {
    setHint(null);
    openInCraft({
      docId: craftDocId,
      spaceId,
      webUrl,
      onHint: ({ webUrl: url }) =>
        setHint({
          text: url ? "Craft did not open. Open the document on the web instead." : "Craft did not open. Install the Craft app or open the note in Craft to view it.",
          webUrl: url,
        }),
    });
  }, [craftDocId, spaceId, webUrl]);

  const refresh = useCallback(() => {
    void refreshPreview(craftDocId, { force: true });
  }, [craftDocId]);

  const remove = useCallback(() => removeNodes([id]), [id, removeNodes]);

  return (
    <div
      className={`cc-card group/card ${missing ? "cc-card--missing" : ""}`}
      style={style}
      data-doc-id={craftDocId}
      onDoubleClick={(e) => {
        e.stopPropagation();
        open();
      }}
    >
      <NodeResizer isVisible={selected} minWidth={MIN_SIZES.file.width} minHeight={MIN_SIZES.file.height} onResizeStart={() => beginBatch()} />
      <NodeHandles />

      <div className="cc-card__actions nodrag nopan" onDoubleClick={(e) => e.stopPropagation()}>
        <ActionButton label="Open in Craft" onClick={open}>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </ActionButton>
        <ActionButton label={loading ? "Refreshing preview" : "Refresh preview"} onClick={refresh}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
        </ActionButton>
        <ActionButton label="Colour" active={colorOpen} onClick={() => setColorOpen((v) => !v)}>
          <Palette className="h-3.5 w-3.5" aria-hidden />
        </ActionButton>
        <ActionButton label="Remove from canvas" danger onClick={remove}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </ActionButton>
      </div>

      {colorOpen ? (
        <div className="cc-card__popover nodrag nopan" onDoubleClick={(e) => e.stopPropagation()}>
          <ColorPicker
            value={data.color}
            onPick={(c) => {
              setNodesColor([id], c);
              setColorOpen(false);
            }}
          />
        </div>
      ) : null}

      {count > 1 ? (
        <span className="cc-card__badge" title={`This note is on the canvas ${count} times`} aria-label={`On canvas ${count} times`}>
          {count}
        </span>
      ) : null}

      <div className="flex h-full w-full flex-col gap-1 overflow-hidden p-3">
        <div className="flex items-start gap-2 pr-24">
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
          <div className="flex items-center gap-1.5 text-xs text-zinc-500" data-missing>
            <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">Missing in Craft</span>
            {preview ? <span className="truncate">Last preview kept.</span> : null}
          </div>
        ) : null}
        {preview ? (
          <div className="min-h-0 flex-1 overflow-hidden text-zinc-700 dark:text-zinc-300">
            <MarkdownView text={preview} />
          </div>
        ) : loading ? (
          <Shimmer />
        ) : missing ? null : (
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            No preview yet
          </div>
        )}
      </div>

      {hint ? (
        <div className="cc-card__hint nodrag nopan" role="status">
          <span>{hint.text}</span>
          {hint.webUrl ? (
            <a href={hint.webUrl} target="_blank" rel="noreferrer noopener" className="underline" onClick={() => setHint(null)}>
              Open on the web
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
