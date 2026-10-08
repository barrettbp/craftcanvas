/**
 * `.canvas` export (spec section 4 and 9). The stored document already follows
 * JSON Canvas 1.0 with our `craftcanvas` extension blocks, so exporting is a
 * matter of producing a clean object: only `nodes`, `edges` and the top level
 * `craftcanvas` block, no `undefined` values, keys in a stable order.
 *
 * Pure: safe to use on the server (export route) and in the browser (export
 * menu serialising the store directly).
 */
import { canvasDataSchema } from "@/lib/canvas/schema";
import type { CanvasData, CanvasEdge, CanvasNode } from "@/lib/canvas/types";

export const CANVAS_FILE_EXTENSION = ".canvas";
export const CANVAS_FILE_MIME = "application/json";

/** The exported document: JSON Canvas 1.0 plus the `craftcanvas` block. */
export type JsonCanvasFile = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  craftcanvas?: NonNullable<CanvasData["craftcanvas"]>;
};

/** Removes `undefined` values recursively (JSON.stringify would drop them anyway, but callers compare objects). */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Builds the JSON Canvas object for `data`. The input is validated first so an
 * exported file never contains keys the schema does not know about; per node
 * `craftcanvas` extensions and the `file` path of note cards are kept as is.
 */
export function toJsonCanvas(data: CanvasData): JsonCanvasFile {
  const parsed = canvasDataSchema.parse(data);
  const file: JsonCanvasFile = {
    nodes: parsed.nodes.map((n) => stripUndefined(n)),
    edges: parsed.edges.map((e) => stripUndefined(e)),
  };
  if (parsed.craftcanvas) file.craftcanvas = stripUndefined(parsed.craftcanvas);
  return file;
}

/** Pretty printed file contents. */
export function serialiseCanvasFile(data: CanvasData): string {
  return `${JSON.stringify(toJsonCanvas(data), null, 2)}\n`;
}

const MAX_BASENAME = 120;

/** Turns a canvas title into a safe file name, e.g. `Q3 plan / ideas` -> `Q3 plan - ideas.canvas`. */
export function safeFilename(title: string, fallback = "canvas"): string {
  const cleaned = title
    .normalize("NFKC")
    // Characters that are illegal on Windows or macOS file systems, plus control characters.
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim()
    .slice(0, MAX_BASENAME)
    .trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

/** `<safe title>.canvas` */
export function filenameFor(title: string): string {
  return `${safeFilename(title)}${CANVAS_FILE_EXTENSION}`;
}

/** Value for a `Content-Disposition: attachment` header; non ASCII titles get the RFC 5987 form as well. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
