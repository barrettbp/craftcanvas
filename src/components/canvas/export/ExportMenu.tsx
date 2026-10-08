"use client";

/**
 * "Export" menu in the top bar (spec section 4): download the canvas as a
 * JSON Canvas `.canvas` file or as a PNG of the content at 2x. The `.canvas`
 * file is serialised from the store so unsaved edits are included; the PNG is
 * rasterised from the React Flow viewport element.
 */
import { ChevronDown, Download, FileJson, Image as ImageIcon, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CANVAS_FILE_MIME, filenameFor, serialiseCanvasFile } from "@/lib/export/canvas-file";
import { canvasBackground, contentBounds, findViewportElement } from "@/lib/export/capture";
import { downloadDataUrl, downloadText } from "@/lib/export/download";
import { exportCanvasPng, pngFilenameFor } from "@/lib/export/png";
import { useCanvasStore } from "@/store/canvas-store";

type Props = {
  canvasId: string;
  /** Where to look for the React Flow viewport; defaults to the whole document. */
  root?: ParentNode | null;
};

export function ExportMenu({ root }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"png" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasNodes = useCanvasStore((s) => s.nodes.length > 0);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const exportCanvasFile = () => {
    setOpen(false);
    const s = useCanvasStore.getState();
    try {
      downloadText(serialiseCanvasFile(s.getCanvasData()), filenameFor(s.title), CANVAS_FILE_MIME);
    } catch {
      setError("Could not export the canvas file");
    }
  };

  const exportPng = async () => {
    setOpen(false);
    const s = useCanvasStore.getState();
    const element = findViewportElement(root ?? document);
    const bounds = contentBounds(s.nodes);
    if (!element || !bounds) {
      setError("Nothing to export yet");
      return;
    }
    setBusy("png");
    try {
      const dataUrl = await exportCanvasPng({ element, nodesBounds: bounds, background: canvasBackground(element) });
      downloadDataUrl(dataUrl, pngFilenameFor(s.title));
    } catch {
      setError("Could not render the PNG");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={menuRef} className="relative flex items-center gap-2" data-export-menu>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Export"
        title="Export"
        disabled={busy !== null}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />}
        <span className="hidden sm:inline">{busy ? "Rendering…" : "Export"}</span>
        <ChevronDown className="h-3 w-3" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1 w-48 rounded-lg border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <button
            type="button"
            role="menuitem"
            onClick={exportCanvasFile}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <FileJson className="h-3.5 w-3.5" aria-hidden /> Export .canvas
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!hasNodes}
            title={hasNodes ? "PNG of the whole canvas at 2x" : "Add a card first"}
            onClick={() => void exportPng()}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-zinc-800"
          >
            <ImageIcon className="h-3.5 w-3.5" aria-hidden /> Export PNG
          </button>
        </div>
      ) : null}
      {error ? (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      ) : null}
    </div>
  );
}
