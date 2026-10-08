/**
 * Canvas list thumbnails (spec 8.7): a small 16:10 PNG of the content,
 * rendered in the browser from the same viewport element as the PNG export,
 * then posted to `/api/canvases/:id/thumbnail`.
 */
import type { Rect } from "@xyflow/react";

import type { FetchLike } from "@/lib/canvas/client";

import { captureViewport, DEFAULT_BACKGROUND } from "./capture";
import { dataUrlByteLength, THUMBNAIL_MAX_BYTES } from "./thumbnail-storage";

export const THUMBNAIL_WIDTH = 480;
export const THUMBNAIL_HEIGHT = 300;
export const THUMBNAIL_PADDING = 0.08;

export type RenderThumbnailOptions = {
  element: HTMLElement;
  nodesBounds: Rect;
  background?: string;
};

/** A 480x300 (1x) PNG data URL with the content fitted inside. */
export function renderThumbnail({ element, nodesBounds, background = DEFAULT_BACKGROUND }: RenderThumbnailOptions): Promise<string> {
  return captureViewport({
    element,
    nodesBounds,
    pixelRatio: 1,
    background,
    fit: { width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT, padding: THUMBNAIL_PADDING, minZoom: 0.02, maxZoom: 1.5 },
  });
}

/** True when the server would accept this data URL (size wise). */
export function fitsThumbnailLimit(dataUrl: string): boolean {
  const bytes = dataUrlByteLength(dataUrl);
  return bytes !== null && bytes <= THUMBNAIL_MAX_BYTES;
}

export type PostThumbnailResult = { ok: true; thumbnail: string | null } | { ok: false; status: number };

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export async function postThumbnail(canvasId: string, dataUrl: string, fetchImpl: FetchLike = defaultFetch): Promise<PostThumbnailResult> {
  const res = await fetchImpl(`/api/canvases/${canvasId}/thumbnail`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dataUrl }),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const body = (await res.json().catch(() => ({}))) as { thumbnail?: string | null };
  return { ok: true, thumbnail: body.thumbnail ?? null };
}
