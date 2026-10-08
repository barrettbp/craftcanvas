"use client";

/**
 * Left panel slot. WP3 replaces the body of this component with the real
 * `NotesPanel` from `@/components/notes-panel` and keeps the contract:
 *
 *   props: { canvasId: string }
 *   - Render the panel inside an element with `data-notes-panel`.
 *   - Render the search box as an `<input data-notes-search>` so Cmd/Ctrl K
 *     (and the "Note" toolbar button) can focus it via `focusNotesSearch()`.
 *   - Read `docIdsOnCanvas` with `selectDocIdsOnCanvas(useCanvasStore.getState())`
 *     and add cards with `useCanvasStore.getState().addFileNode(ext, position)`.
 */
import { FileText } from "lucide-react";
import Link from "next/link";

export type NotesPanelSlotProps = { canvasId: string };

export function NotesPanelSlot({ canvasId }: NotesPanelSlotProps) {
  return (
    <div data-notes-panel data-canvas-id={canvasId} className="flex h-full flex-col">
      <div className="border-b border-zinc-200 p-3 dark:border-zinc-800">
        <input
          data-notes-search
          type="search"
          placeholder="Search notes (⌘K)"
          aria-label="Search notes"
          className="w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-zinc-500">
        <FileText className="h-6 w-6" aria-hidden />
        <p>Notes panel coming.</p>
        <p className="text-xs">
          Your Craft documents will appear here once the connection is set up in{" "}
          <Link href="/settings/craft" className="underline">
            Settings › Craft
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
