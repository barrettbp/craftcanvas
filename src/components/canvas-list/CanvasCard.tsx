"use client";

import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { relativeTime } from "@/lib/canvas/relative-time";
import type { CanvasSummary } from "@/lib/canvas/types";

type CanvasCardProps = {
  canvas: CanvasSummary;
  onRename: (title: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

export function CanvasCard({ canvas, onRename, onDuplicate, onDelete }: CanvasCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(canvas.title);
  const [confirming, setConfirming] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [menuOpen]);

  const startRename = () => {
    setDraft(canvas.title);
    setRenaming(true);
    setMenuOpen(false);
  };

  const commitRename = () => {
    const next = draft.trim();
    setRenaming(false);
    if (next && next !== canvas.title) onRename(next);
  };

  const thumbnail = canvas.thumbnail && /^(data:|https?:)/.test(canvas.thumbnail) ? canvas.thumbnail : null;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
      <Link href={`/canvas/${canvas.id}`} className="block aspect-[16/10] w-full bg-zinc-100 dark:bg-zinc-800" aria-label={`Open ${canvas.title}`}>
        {thumbnail ? (
          // Thumbnails are data URLs or storage URLs; next/image is not a fit here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">No preview yet</div>
        )}
      </Link>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              value={draft}
              aria-label="Canvas title"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setRenaming(false);
                }
              }}
              maxLength={200}
              className="w-full rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-sm font-medium outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-900"
            />
          ) : (
            <Link href={`/canvas/${canvas.id}`} className="block truncate text-sm font-medium" title={canvas.title} onDoubleClick={startRename}>
              {canvas.title}
            </Link>
          )}
          <p className="mt-0.5 text-xs text-zinc-500">Updated {relativeTime(canvas.updatedAt)}</p>
        </div>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label="Canvas actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </button>
          {menuOpen ? (
            <div role="menu" className="absolute right-0 z-10 mt-1 w-40 rounded-lg border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <button type="button" role="menuitem" onClick={startRename} className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <Pencil className="h-3.5 w-3.5" aria-hidden /> Rename
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onDuplicate();
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden /> Duplicate
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirming(true);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {confirming ? (
        <div role="alertdialog" aria-label={`Delete ${canvas.title}?`} className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/95 p-4 text-center dark:bg-zinc-900/95">
          <p className="text-sm font-medium">Delete “{canvas.title}”?</p>
          <p className="text-xs text-zinc-500">This cannot be undone. Your notes in Craft are not affected.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onDelete();
              }}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
