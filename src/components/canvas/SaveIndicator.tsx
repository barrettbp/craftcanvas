"use client";

import { AlertTriangle, Check, CloudOff, Loader2 } from "lucide-react";
import { useEffect, useReducer } from "react";

import { relativeTime } from "@/lib/canvas/relative-time";
import { useCanvasStore } from "@/store/canvas-store";

/** "Saved 2s ago" / "Saving…" / "Offline" / "Updated in another tab" (spec section 10). */
export function SaveIndicator() {
  const saveState = useCanvasStore((s) => s.saveState);
  const dirty = useCanvasStore((s) => s.dirty);
  const lastSavedAt = useCanvasStore((s) => s.lastSavedAt);
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, []);

  let icon: React.ReactNode;
  let label: string;
  let tone = "text-zinc-500";
  if (saveState === "conflict") {
    icon = <AlertTriangle className="h-3.5 w-3.5" aria-hidden />;
    label = "Updated in another tab";
    tone = "text-amber-600 dark:text-amber-400";
  } else if (saveState === "offline") {
    icon = <CloudOff className="h-3.5 w-3.5" aria-hidden />;
    label = "Offline · will retry";
    tone = "text-red-600 dark:text-red-400";
  } else if (saveState === "saving" || dirty) {
    icon = <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />;
    label = "Saving…";
  } else {
    icon = <Check className="h-3.5 w-3.5" aria-hidden />;
    label = lastSavedAt ? `Saved ${relativeTime(lastSavedAt)}` : "Saved";
  }

  return (
    <span className={`flex items-center gap-1 text-xs ${tone}`} role="status" aria-live="polite" data-save-state={saveState}>
      {icon}
      {label}
    </span>
  );
}
