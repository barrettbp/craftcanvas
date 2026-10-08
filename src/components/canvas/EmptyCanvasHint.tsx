"use client";

/**
 * Shows the empty canvas hint overlay until the document has a node.
 * Rendered by `CanvasEditor` next to the canvas; the look lives in
 * `src/components/ui/EmptyState.tsx`.
 */
import { CanvasHint } from "@/components/ui/EmptyState";
import { useCanvasStore } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";

export function EmptyCanvasHint() {
  const empty = useCanvasStore((s) => s.nodes.length === 0);
  const hasNotes = useUiStore((s) => s.craft.connectionId !== null);
  if (!empty) return null;
  return <CanvasHint hasNotes={hasNotes} />;
}

export default EmptyCanvasHint;
