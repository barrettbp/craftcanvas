/**
 * Pure helpers for the thumbnail route: body validation, PNG data URL parsing
 * with a size cap, and the decision of where a thumbnail is stored. Nothing
 * here touches env, the network or the database.
 */
import { z } from "zod";

/** Decoded PNG size cap. A 480x300 canvas snapshot is normally well under 100 KB. */
export const THUMBNAIL_MAX_BYTES = 400 * 1024;

export const thumbnailBodySchema = z.object({
  dataUrl: z.string().min(1).max(Math.ceil((THUMBNAIL_MAX_BYTES * 4) / 3) + 64),
});

export type ThumbnailBody = z.infer<typeof thumbnailBodySchema>;

const PNG_DATA_URL_RE = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;
/** First 8 bytes of every PNG file. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Decoded byte length of a base64 data URL, or `null` when it is not one. */
export function dataUrlByteLength(dataUrl: string): number | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0 || !/;base64,/.test(dataUrl.slice(0, comma + 1))) return null;
  const base64 = dataUrl.slice(comma + 1);
  if (base64.length % 4 !== 0) return null;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

export type ParsedPng = { base64: string; bytes: number };

export type ParsePngResult = { ok: true; png: ParsedPng } | { ok: false; reason: "not_png_data_url" | "bad_signature" | "too_large" };

/**
 * Accepts only a `data:image/png;base64,...` URL whose payload starts with the
 * PNG signature and decodes to at most `maxBytes`.
 */
export function parsePngDataUrl(dataUrl: string, maxBytes = THUMBNAIL_MAX_BYTES): ParsePngResult {
  const match = PNG_DATA_URL_RE.exec(dataUrl);
  if (!match) return { ok: false, reason: "not_png_data_url" };
  const base64 = match[1];
  const bytes = dataUrlByteLength(dataUrl);
  if (bytes === null) return { ok: false, reason: "not_png_data_url" };
  if (bytes > maxBytes) return { ok: false, reason: "too_large" };
  if (bytes < PNG_SIGNATURE.length) return { ok: false, reason: "bad_signature" };
  // 12 base64 chars decode to the first 9 bytes.
  const head = decodeBase64(base64.slice(0, 12));
  if (!head || PNG_SIGNATURE.some((b, i) => head[i] !== b)) return { ok: false, reason: "bad_signature" };
  return { ok: true, png: { base64, bytes } };
}

function decodeBase64(chunk: string): Uint8Array | null {
  try {
    const binary = atob(chunk);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export type ThumbnailStorageDecision =
  | { kind: "supabase"; bucket: string; path: string }
  | { kind: "inline" };

export type StorageDecisionInput = {
  /** Both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set. */
  hasSupabase: boolean;
  bucket: string;
  userId: string;
  canvasId: string;
};

/**
 * Where a thumbnail lives: Supabase Storage at `<userId>/<canvasId>.png` when
 * the service is configured, otherwise the data URL goes straight into
 * `canvases.thumbnail`.
 */
export function decideThumbnailStorage({ hasSupabase, bucket, userId, canvasId }: StorageDecisionInput): ThumbnailStorageDecision {
  if (!hasSupabase || bucket.trim().length === 0) return { kind: "inline" };
  return { kind: "supabase", bucket: bucket.trim(), path: `${userId}/${canvasId}.png` };
}
