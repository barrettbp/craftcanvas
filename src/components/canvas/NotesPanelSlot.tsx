"use client";

/**
 * Left panel slot: mounts the real `NotesPanel` (spec 8.6) and connects it to
 * the canvas.
 *
 *   props: { canvasId: string }
 *   - The panel sits inside an element with `data-notes-panel`; the search box
 *     is the `<input data-notes-search>` that `focusNotesSearch()` targets.
 *   - `docIdsOnCanvas` comes from `selectDocIdsOnCanvas` so rows already placed
 *     show their dot.
 *   - The plus icon drops the card at the viewport centre; dragging a row onto
 *     the pane is handled by `Canvas` (`onDrop`).
 */
import { useReactFlow, useStoreApi } from "@xyflow/react";
import { useCallback, useMemo, useRef } from "react";

import { NotesPanel, type NotesPanelDocument } from "@/components/notes-panel/NotesPanel";
import { addCraftDocument } from "@/hooks/useCraftPreviews";
import { cardOriginAt, rectCentre } from "@/lib/canvas/drop";
import { DEFAULT_SIZES } from "@/lib/canvas/types";
import { selectDocIdsOnCanvas, useCanvasStore } from "@/store/canvas-store";

export type NotesPanelSlotProps = { canvasId: string };

export function NotesPanelSlot({ canvasId }: NotesPanelSlotProps) {
  const nodes = useCanvasStore((s) => s.nodes);
  const docIdsOnCanvas = useMemo(() => selectDocIdsOnCanvas({ nodes }), [nodes]);
  const rf = useReactFlow();
  const flowStore = useStoreApi();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const onAddDocument = useCallback(
    (doc: NotesPanelDocument) => {
      const pane = flowStore.getState().domNode;
      const rect = pane?.getBoundingClientRect();
      const centre = rect ? rectCentre(rect) : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      const point = rf.screenToFlowPosition(centre);
      addCraftDocument(doc, cardOriginAt(point, DEFAULT_SIZES.file));
    },
    [rf, flowStore],
  );

  return (
    <div data-notes-panel data-canvas-id={canvasId} className="flex h-full min-h-0 flex-col">
      <NotesPanel docIdsOnCanvas={docIdsOnCanvas} onAddDocument={onAddDocument} searchInputRef={searchInputRef} />
    </div>
  );
}
