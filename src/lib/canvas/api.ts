/**
 * Pure helpers for the `/api/canvases` route handlers: body schemas, id
 * validation, ownership and version checks, and response shapes. Nothing in
 * here touches the database, so it is unit tested without Postgres.
 */
import { z } from "zod";

import { canvasDataSchema } from "./schema";
import type { CanvasData, CanvasDetail, CanvasSummary } from "./types";

export const MAX_TITLE_LENGTH = 200;

export const titleSchema = z
  .string()
  .trim()
  .min(1, "Title is required")
  .max(MAX_TITLE_LENGTH, `Title must be ${MAX_TITLE_LENGTH} characters or fewer`);

export const createCanvasBodySchema = z.object({
  title: titleSchema.optional(),
  data: canvasDataSchema.optional(),
});

export const saveCanvasBodySchema = z.object({
  data: canvasDataSchema,
  version: z.number().int().positive(),
});

export const renameCanvasBodySchema = z.object({
  title: titleSchema,
});

export type CreateCanvasBody = z.infer<typeof createCanvasBodySchema>;
export type SaveCanvasBody = z.infer<typeof saveCanvasBodySchema>;
export type RenameCanvasBody = z.infer<typeof renameCanvasBodySchema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Canvas ids are uuids; anything else is a 404 rather than a database error. */
export function isCanvasId(id: string | undefined | null): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

/** Minimal row shape the ownership check needs. */
export type OwnedRow = { userId: string | null };

/**
 * A canvas is visible only to its owner. Missing rows and rows owned by
 * someone else are indistinguishable from the outside (404 for both).
 */
export function isOwnedBy<T extends OwnedRow>(row: T | null | undefined, userId: string): row is T {
  return !!row && row.userId === userId;
}

export type VersionDecision =
  | { ok: true; nextVersion: number }
  | { ok: false; status: 409; body: { error: "version_conflict"; version: number } };

/**
 * Optimistic concurrency: the client sends the version it loaded. If the row
 * moved on (another tab saved), the save is rejected with 409 and the current
 * version so the client can reload.
 */
export function decideVersion(currentVersion: number, incomingVersion: number): VersionDecision {
  if (currentVersion !== incomingVersion) {
    return { ok: false, status: 409, body: { error: "version_conflict", version: currentVersion } };
  }
  return { ok: true, nextVersion: currentVersion + 1 };
}

export const DEFAULT_TITLE = "Untitled canvas";

/** Title for a duplicate: "Foo (copy)", "Foo (copy 2)", ... */
export function copyTitle(title: string, existingTitles: Iterable<string> = []): string {
  const base = title.replace(/\s\(copy(?: \d+)?\)$/i, "");
  const taken = new Set(existingTitles);
  let candidate = `${base} (copy)`;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base} (copy ${n})`;
    n += 1;
  }
  return candidate;
}

type RowLike = {
  id: string;
  title: string;
  version: number;
  thumbnail: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
};

function iso(value: Date | string | null): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toSummary(row: RowLike): CanvasSummary {
  return {
    id: row.id,
    title: row.title,
    version: row.version,
    thumbnail: row.thumbnail ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toDetail(row: RowLike & { data: unknown }): CanvasDetail {
  return { ...toSummary(row), data: coerceData(row.data) };
}

/** Rows written by older code or by hand are repaired into a valid document. */
export function coerceData(data: unknown): CanvasData {
  const parsed = canvasDataSchema.safeParse(data);
  if (parsed.success) return parsed.data;
  return { nodes: [], edges: [], craftcanvas: { viewport: { x: 0, y: 0, zoom: 1 }, grid: true } };
}

export function jsonError(status: number, error: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error, ...extra }, { status });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}
