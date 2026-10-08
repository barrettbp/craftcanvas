"use client";

import { useState } from "react";

import { renameCanvas } from "@/lib/canvas/client";
import { useCanvasStore } from "@/store/canvas-store";

/** Editable canvas title in the top bar. Commits on blur or Enter via PATCH. */
export function CanvasTitle({ canvasId }: { canvasId: string }) {
  const title = useCanvasStore((s) => s.title);
  const setTitle = useCanvasStore((s) => s.setTitle);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const commit = async () => {
    if (draft === null) return;
    const next = draft.trim();
    setDraft(null);
    if (!next || next === title) return;
    const previous = title;
    setTitle(next);
    setError(null);
    try {
      await renameCanvas(canvasId, next);
    } catch {
      setTitle(previous);
      setError("Could not rename");
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        aria-label="Canvas title"
        className="min-w-0 max-w-md flex-1 truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium outline-none hover:border-zinc-200 focus:border-zinc-300 focus:bg-white dark:hover:border-zinc-700 dark:focus:border-zinc-600 dark:focus:bg-zinc-900"
        value={draft ?? title}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(null);
            e.currentTarget.blur();
          }
          e.stopPropagation();
        }}
        maxLength={200}
      />
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
