/**
 * PNG export (spec section 4): the React Flow viewport rasterised with
 * `html-to-image`, fitted to the content with some padding, at 2x by default.
 */
import type { Rect } from "@xyflow/react";

import { captureViewport, DEFAULT_BACKGROUND } from "./capture";
import { safeFilename } from "./canvas-file";

export const PNG_SCALE = 2;
export const PNG_PADDING = 0.08;
/** Keeps the rasteriser within what browsers can allocate (8192 CSS px * 2x = 16k device px). */
export const PNG_MAX_DIMENSION = 8192;

export type ExportPngOptions = {
  element: HTMLElement;
  nodesBounds: Rect;
  scale?: number;
  background?: string;
};

/** Returns a `data:image/png;base64,...` URL of the canvas content. */
export function exportCanvasPng({ element, nodesBounds, scale = PNG_SCALE, background = DEFAULT_BACKGROUND }: ExportPngOptions): Promise<string> {
  return captureViewport({
    element,
    nodesBounds,
    pixelRatio: scale,
    background,
    fit: { padding: PNG_PADDING, maxDimension: PNG_MAX_DIMENSION / scale, minZoom: 0.01, maxZoom: 4 },
  });
}

export function pngFilenameFor(title: string): string {
  return `${safeFilename(title)}.png`;
}
