/**
 * All parsing of raw Craft Connect API responses lives here.
 *
 * ASSUMPTION (adjust once real responses have been seen):
 * The exact JSON shapes of connect.craft.do are not documented in the spec, so
 * every function below is written defensively:
 *
 * - A list may come back as a bare array, or wrapped in `{ folders }`,
 *   `{ documents }`, `{ items }`, `{ results }`, or `{ data }`.
 * - A folder is `{ id, name | title, parentId | parentFolderId | parent, path? }`.
 * - A document is `{ id | documentId, title | name, folderId | location | parentId,
 *   updatedAt | lastModifiedAt | modifiedAt | updated_at (ISO string or epoch),
 *   url | webUrl | shareUrl | link }`.
 * - Markdown may come back as a plain `text/markdown` body, or as JSON with a
 *   `markdown` / `content` / `text` string field.
 *
 * Missing fields never throw; they fall back to "" or `undefined`.
 */
import type { CraftDocument, CraftFolder } from "./types";

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function firstString(obj: Json, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = str(obj[key]);
    if (v !== undefined) return v;
  }
  return undefined;
}

function toIso(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Seconds vs milliseconds: anything before year 2001 in ms is treated as seconds.
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}

/** Unwraps `{ folders: [...] }`, `{ items: [...] }` etc. into an array of records. */
export function unwrapList(payload: unknown, preferredKeys: readonly string[] = []): Json[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  for (const key of [...preferredKeys, "items", "results", "data", "list"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
    // One level of nesting, e.g. { data: { documents: [...] } }
    if (isRecord(value)) {
      for (const inner of [...preferredKeys, "items", "results"]) {
        if (Array.isArray(value[inner])) return (value[inner] as unknown[]).filter(isRecord);
      }
    }
  }
  return [];
}

const FOLDER_ID_KEYS = ["id", "folderId", "folder_id"] as const;
const FOLDER_NAME_KEYS = ["name", "title", "label"] as const;
const FOLDER_PARENT_KEYS = ["parentId", "parentFolderId", "parent_id", "parent"] as const;

/**
 * Normalises a `GET /folders` payload. Computes `path` by walking parents when
 * Craft does not provide one. Folders may be nested (`children`), flat, or both.
 */
export function normaliseFolders(payload: unknown): CraftFolder[] {
  const flat: Array<{ id: string; name: string; parentId?: string; path?: string }> = [];

  const visit = (raw: Json, inheritedParent?: string) => {
    const id = firstString(raw, FOLDER_ID_KEYS);
    if (!id) return;
    const name = firstString(raw, FOLDER_NAME_KEYS) ?? "Untitled folder";
    const parentRaw = raw["parent"];
    const parentId =
      firstString(raw, FOLDER_PARENT_KEYS) ??
      (isRecord(parentRaw) ? firstString(parentRaw, FOLDER_ID_KEYS) : undefined) ??
      inheritedParent;
    const path = firstString(raw, ["path", "folderPath"]);
    flat.push({ id, name, parentId: parentId === id ? undefined : parentId, path });
    const children = raw["children"] ?? raw["folders"] ?? raw["subfolders"];
    if (Array.isArray(children)) {
      for (const child of children) if (isRecord(child)) visit(child, id);
    }
  };

  for (const raw of unwrapList(payload, ["folders"])) visit(raw);

  // De-duplicate by id (a nested payload may also list children flat).
  const byId = new Map<string, (typeof flat)[number]>();
  for (const f of flat) if (!byId.has(f.id)) byId.set(f.id, f);

  const pathCache = new Map<string, string>();
  const pathOf = (id: string, seen: Set<string>): string => {
    const cached = pathCache.get(id);
    if (cached !== undefined) return cached;
    const f = byId.get(id);
    if (!f) return "";
    let path: string;
    if (f.path) {
      path = f.path.replace(/^\/+|\/+$/g, "");
    } else if (f.parentId && byId.has(f.parentId) && !seen.has(f.parentId)) {
      seen.add(f.parentId);
      const parent = pathOf(f.parentId, seen);
      path = parent ? `${parent}/${f.name}` : f.name;
    } else {
      path = f.name;
    }
    pathCache.set(id, path);
    return path;
  };

  return [...byId.values()].map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId && byId.has(f.parentId) ? f.parentId : undefined,
    path: pathOf(f.id, new Set([f.id])),
  }));
}

const DOC_ID_KEYS = ["id", "documentId", "document_id", "docId", "blockId"] as const;
const DOC_TITLE_KEYS = ["title", "name", "documentTitle"] as const;
const DOC_FOLDER_KEYS = ["folderId", "folder_id", "location", "parentId", "parent_id"] as const;
const DOC_UPDATED_KEYS = ["updatedAt", "lastModifiedAt", "modifiedAt", "updated_at", "lastModified", "modified"] as const;
const DOC_URL_KEYS = ["webUrl", "url", "shareUrl", "share_url", "link", "clickableLink"] as const;

export type DocumentContext = {
  /** Folder the list was requested for (fills `folderId` when the row lacks one). */
  folderId?: string;
  /** Folder id → path, used to fill `folderPath`. */
  folderPathById?: ReadonlyMap<string, string>;
};

/** Normalises one raw document record. Returns `undefined` when there is no id. */
export function normaliseDocument(raw: unknown, ctx: DocumentContext = {}): CraftDocument | undefined {
  if (!isRecord(raw)) return undefined;
  const id = firstString(raw, DOC_ID_KEYS);
  if (!id) return undefined;

  const folderRaw = raw["folder"];
  const folderId =
    firstString(raw, DOC_FOLDER_KEYS) ??
    (isRecord(folderRaw) ? firstString(folderRaw, FOLDER_ID_KEYS) : undefined) ??
    ctx.folderId;

  const explicitPath = firstString(raw, ["folderPath", "path"]) ?? (isRecord(folderRaw) ? firstString(folderRaw, ["path"]) : undefined);
  const folderPath = (explicitPath ?? (folderId ? ctx.folderPathById?.get(folderId) : undefined) ?? "").replace(
    /^\/+|\/+$/g,
    "",
  );

  const updatedAt = (() => {
    for (const key of DOC_UPDATED_KEYS) {
      const iso = toIso(raw[key]);
      if (iso) return iso;
    }
    return undefined;
  })();

  const webUrl = firstString(raw, DOC_URL_KEYS);

  return {
    id,
    title: firstString(raw, DOC_TITLE_KEYS) ?? "Untitled",
    folderId,
    folderPath,
    updatedAt,
    webUrl: webUrl && /^https?:\/\//i.test(webUrl) ? webUrl : undefined,
  };
}

/** Normalises a `GET /documents` or `GET /documents/search` payload. */
export function normaliseDocuments(payload: unknown, ctx: DocumentContext = {}): CraftDocument[] {
  const out: CraftDocument[] = [];
  const seen = new Set<string>();
  for (const raw of unwrapList(payload, ["documents", "docs"])) {
    const doc = normaliseDocument(raw, ctx);
    if (doc && !seen.has(doc.id)) {
      seen.add(doc.id);
      out.push(doc);
    }
  }
  return out;
}

/**
 * Turns a `GET /blocks?documentId=...` body into markdown text. The request
 * asks for `text/markdown`; if Craft answers JSON anyway we look for a string
 * field or join block `markdown` / `content` fields.
 */
export function normaliseMarkdown(body: string, contentType: string | null): string {
  const isJson = contentType?.toLowerCase().includes("json") || /^\s*[[{]/.test(body);
  if (!isJson) return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (typeof parsed === "string") return parsed;
  if (isRecord(parsed)) {
    const direct = firstString(parsed, ["markdown", "content", "text", "body"]);
    if (direct) return direct;
  }
  const blocks = unwrapList(parsed, ["blocks", "content"]);
  const parts = blocks
    .map((b) => firstString(b, ["markdown", "content", "text"]))
    .filter((p): p is string => typeof p === "string");
  return parts.join("\n\n");
}

/** Best effort: find a space id in any payload so deep links can include it. */
export function extractSpaceId(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const direct = firstString(payload, ["spaceId", "space_id"]);
  if (direct) return direct;
  const space = payload["space"];
  if (isRecord(space)) return firstString(space, ["id", "spaceId"]);
  return undefined;
}
