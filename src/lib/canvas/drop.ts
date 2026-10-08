/**
 * Pure helpers for dropping Craft documents on the canvas (spec 8.6): reading
 * the drag payload and turning a screen point into a card origin.
 */
import { CRAFT_DOC_DRAG_TYPE, type CraftDocDragPayload } from "@/lib/craft/types";

import type { FileNodeExtension } from "./types";

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

/** Minimal `DataTransfer` surface so the helpers can be tested without a DOM. */
export type DropData = { types?: ArrayLike<string> | Iterable<string>; getData: (type: string) => string };

/** True when a drag carries the notes panel payload (checked in `dragover`). */
export function hasDocDrag(data: Pick<DropData, "types"> | null | undefined): boolean {
  if (!data?.types) return false;
  return Array.from(data.types as Iterable<string>).includes(CRAFT_DOC_DRAG_TYPE);
}

/** Parses the `application/x-craftcanvas-doc` payload, or `null` when absent or malformed. */
export function parseDocDrop(data: DropData | null | undefined): CraftDocDragPayload | null {
  if (!data) return null;
  let raw = "";
  try {
    raw = data.getData(CRAFT_DOC_DRAG_TYPE);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CraftDocDragPayload> | null;
    if (!parsed || typeof parsed.craftDocId !== "string" || parsed.craftDocId.length === 0) return null;
    return {
      craftDocId: parsed.craftDocId,
      title: typeof parsed.title === "string" ? parsed.title : "",
      folderPath: typeof parsed.folderPath === "string" ? parsed.folderPath : "",
    };
  } catch {
    return null;
  }
}

/** Top left corner of a card of `size` centred on `point` (flow coordinates). */
export function cardOriginAt(point: Point, size: Size): Point {
  return { x: point.x - size.width / 2, y: point.y - size.height / 2 };
}

/** Screen coordinates of the centre of a rectangle (e.g. the pane's bounding rect). */
export function rectCentre(rect: { left: number; top: number; width: number; height: number }): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Builds the file node extension for a dropped document. */
export function docToFileExtension(doc: CraftDocDragPayload, connectionId: string): FileNodeExtension {
  const ext: FileNodeExtension = { craftDocId: doc.craftDocId, connectionId, title: doc.title || "Untitled" };
  if (doc.folderPath) ext.folderPath = doc.folderPath;
  return ext;
}
