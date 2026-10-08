/**
 * Small empty and hint states (spec M4). Presentational only, so they are
 * safe in server and client components alike.
 *
 * - `<EmptyState>`: centred icon, title, description and an optional action.
 *   `size="sm"` is the compact variant for panels and "no results" messages.
 * - `<CanvasHint>`: the translucent overlay shown over an empty canvas. The
 *   wrapper that decides *when* to show it lives next to the canvas
 *   (`src/components/canvas/EmptyCanvasHint.tsx`).
 */
import { MousePointerClick } from "lucide-react";
import type { ReactNode } from "react";

export type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  size?: "md" | "sm";
  /** Dashed outline, for a page level "nothing here yet" box. */
  outlined?: boolean;
  className?: string;
};

export function EmptyState({ title, description, icon, action, size = "md", outlined = false, className = "" }: EmptyStateProps) {
  const compact = size === "sm";
  return (
    <div
      role="status"
      className={`flex flex-col items-center text-center ${compact ? "gap-1.5 px-4 py-6" : "gap-3 px-6 py-16"} ${
        outlined ? "rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700" : ""
      } ${className}`}
    >
      {icon ? <div className={`text-zinc-400 ${compact ? "[&>svg]:h-5 [&>svg]:w-5" : "[&>svg]:h-8 [&>svg]:w-8"}`}>{icon}</div> : null}
      <p className={compact ? "text-sm font-medium text-zinc-700 dark:text-zinc-200" : "text-lg font-medium"}>{title}</p>
      {description ? (
        <div className={`max-w-md text-zinc-500 dark:text-zinc-400 ${compact ? "text-xs" : "text-sm"}`}>{description}</div>
      ) : null}
      {action ? <div className={compact ? "mt-1" : "mt-2"}>{action}</div> : null}
    </div>
  );
}

export type CanvasHintProps = {
  /** Set when a Craft connection exists, so the hint mentions the notes panel. */
  hasNotes?: boolean;
};

/** "Double click to add a text card, or drag a note from the panel". Pointer events pass through. */
export function CanvasHint({ hasNotes = true }: CanvasHintProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6" data-empty-canvas-hint aria-live="polite">
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white/80 px-6 py-5 text-center shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/80">
        <MousePointerClick className="mx-auto h-6 w-6 text-zinc-400" aria-hidden />
        <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">This canvas is empty</p>
        <p className="mt-1 max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
          {hasNotes ? "Double click to add a text card, or drag a note from the panel." : "Double click to add a text card. Connect Craft in settings to drag your notes in."}
        </p>
        <p className="mt-2 text-[11px] text-zinc-400">
          Press <kbd className="rounded border border-zinc-300 px-1 font-sans dark:border-zinc-600">T</kbd> for a text card,{" "}
          <kbd className="rounded border border-zinc-300 px-1 font-sans dark:border-zinc-600">?</kbd> for all shortcuts.
        </p>
      </div>
    </div>
  );
}

export default EmptyState;
