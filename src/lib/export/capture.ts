/**
 * Shared bits for rasterising the React Flow viewport with `html-to-image`:
 * content bounds from the store's nodes, the image size and transform that
 * fit those bounds, and the actual capture. PNG export and thumbnails both
 * build on `captureViewport`.
 *
 * The pure helpers (`contentBounds`, `fitToContent`) are unit tested; the
 * capture itself is tested with `html-to-image` mocked.
 */
import { getViewportForBounds, type Rect, type Viewport } from "@xyflow/react";
import { toPng } from "html-to-image";

import { absoluteRects, type FlowNode } from "@/lib/canvas/convert";

export const VIEWPORT_SELECTOR = ".react-flow__viewport";
export const DEFAULT_BACKGROUND = "#ffffff";

/** Smallest rectangle (canvas coordinates) around every node, or `null` for an empty canvas. */
export function contentBounds(nodes: FlowNode[]): Rect | null {
  if (nodes.length === 0) return null;
  const rects = absoluteRects(nodes);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects.values()) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (!Number.isFinite(minX) || maxX - minX <= 0 || maxY - minY <= 0) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export type FitOptions = {
  /** Fraction of the image left blank around the content on each side (0.1 = 10%). */
  padding?: number;
  /** Fixed output size (CSS pixels). When omitted the image is sized to the content at zoom 1. */
  width?: number;
  height?: number;
  /** Largest allowed width or height in CSS pixels when sizing to content. */
  maxDimension?: number;
  minZoom?: number;
  maxZoom?: number;
};

export type Fit = { width: number; height: number; viewport: Viewport };

/**
 * Image size and viewport transform that show `bounds` with `padding` around
 * it. With `width`/`height` the content is letterboxed into that box; otherwise
 * the box is the content itself plus padding, shrunk to `maxDimension`.
 */
export function fitToContent(bounds: Rect, options: FitOptions = {}): Fit {
  const padding = Math.min(Math.max(options.padding ?? 0.1, 0), 0.45);
  const minZoom = options.minZoom ?? 0.01;
  const maxZoom = options.maxZoom ?? 4;
  let width: number;
  let height: number;
  if (options.width && options.height) {
    width = Math.round(options.width);
    height = Math.round(options.height);
  } else {
    const maxDimension = options.maxDimension ?? 8192;
    const grow = 1 / (1 - 2 * padding);
    width = Math.ceil(bounds.width * grow);
    height = Math.ceil(bounds.height * grow);
    const largest = Math.max(width, height);
    if (largest > maxDimension) {
      const shrink = maxDimension / largest;
      width = Math.max(1, Math.floor(width * shrink));
      height = Math.max(1, Math.floor(height * shrink));
    }
  }
  // A percentage string means "this fraction of the image per side"; a bare number is interpreted differently by xyflow.
  const percent = `${Math.round(padding * 10000) / 100}%` as const;
  const viewport = getViewportForBounds(bounds, width, height, minZoom, maxZoom, percent);
  return { width, height, viewport };
}

/** The React Flow viewport element (the transformed layer holding nodes and edges). */
export function findViewportElement(root: ParentNode | null | undefined = typeof document === "undefined" ? null : document): HTMLElement | null {
  return (root?.querySelector(VIEWPORT_SELECTOR) as HTMLElement | null) ?? null;
}

/** Background colour of the flow behind `element`, so exports match what the user sees. */
export function canvasBackground(element: HTMLElement | null, fallback = DEFAULT_BACKGROUND): string {
  const flow = element?.closest(".react-flow") as HTMLElement | null;
  if (!flow || typeof getComputedStyle !== "function") return fallback;
  const color = getComputedStyle(flow).backgroundColor;
  if (!color || color === "transparent" || /^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)$/.test(color)) return fallback;
  return color;
}

export type CaptureOptions = {
  element: HTMLElement;
  nodesBounds: Rect;
  /** Device pixel ratio of the output (2 for a crisp export, 1 for thumbnails). */
  pixelRatio: number;
  background?: string;
  fit?: FitOptions;
};

/** Renders the viewport to a PNG data URL, fitted to `nodesBounds`. */
export async function captureViewport({ element, nodesBounds, pixelRatio, background, fit }: CaptureOptions): Promise<string> {
  const { width, height, viewport } = fitToContent(nodesBounds, fit);
  return toPng(element, {
    backgroundColor: background ?? DEFAULT_BACKGROUND,
    width,
    height,
    pixelRatio,
    cacheBust: false,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
    // Selection rings and resize handles are editor chrome, not content.
    filter: (node) => !node.classList?.contains("react-flow__resize-control"),
  });
}
