/**
 * Full-text search index over Craft notes, canvas objects and PDF pages (D1 FTS5).
 * Every writer calls indexDoc / removeDoc so the index follows the content lifecycle.
 */
import type { SearchKind, SearchResult, ObjectKind } from "../shared/types";
import { cleanMarkdown } from "./craft/parse";

/** Lowercase, strip combining marks, map đ/Đ to d. Used for the `norm` column and for queries. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

export type IndexDoc = {
  kind: SearchKind;
  docId: string;
  page?: number | null;
  boardId?: string | null;
  title: string;
  body: string;
};

export function docKey(d: Pick<IndexDoc, "kind" | "docId" | "page">): string {
  return d.kind === "pdf_page" ? `pdf_page:${d.docId}:${d.page ?? 0}` : `${d.kind}:${d.docId}`;
}

const MAX_BODY = 200_000;

export function indexStatement(db: D1Database, d: IndexDoc): D1PreparedStatement {
  const title = (d.title ?? "").slice(0, 500);
  const body = (d.body ?? "").slice(0, MAX_BODY);
  const norm = normalizeText(`${title}\n${body}`);
  return db
    .prepare(
      `INSERT INTO search_docs (key, doc_kind, doc_id, page, board_id, title, body, norm) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET doc_kind = excluded.doc_kind, doc_id = excluded.doc_id, page = excluded.page,
         board_id = excluded.board_id, title = excluded.title, body = excluded.body, norm = excluded.norm`,
    )
    .bind(docKey(d), d.kind, d.docId, d.page ?? null, d.boardId ?? null, title, body, norm);
}

export function removeStatement(db: D1Database, kind: SearchKind, docId: string): D1PreparedStatement {
  return db.prepare("DELETE FROM search_docs WHERE doc_kind = ? AND doc_id = ?").bind(kind, docId);
}

export async function indexDoc(db: D1Database, d: IndexDoc): Promise<void> {
  await indexStatement(db, d).run();
}

export async function removeDoc(db: D1Database, kind: SearchKind, docId: string): Promise<void> {
  await removeStatement(db, kind, docId).run();
}

/** Index text for a note from its cleaned markdown. */
export function noteIndexDoc(id: string, title: string, markdown: string): IndexDoc {
  return { kind: "note", docId: id, title, body: cleanMarkdown(markdown) };
}

export function objectIndexDoc(o: { id: string; boardId: string; kind: ObjectKind; title: string | null; text: string | null; url: string | null; meta: Record<string, unknown> }): IndexDoc {
  const extra: string[] = [];
  if (o.url) extra.push(o.url);
  if (typeof o.meta.author === "string") extra.push(o.meta.author);
  return { kind: "object", docId: o.id, boardId: o.boardId, title: o.title ?? "", body: [o.text ?? "", ...extra].join("\n") };
}

/** Build an FTS5 MATCH expression: every word as a quoted prefix term over all three columns. */
export function buildMatch(query: string): string | null {
  const words = normalizeText(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)
    .map((w) => w.slice(0, 64))
    .slice(0, 12);
  if (!words.length) return null;
  // Each word is a quoted prefix term; all three columns are searched (the FTS table has no others).
  return words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(" ");
}

type Row = {
  key: string;
  doc_kind: SearchKind;
  doc_id: string;
  page: number | null;
  board_id: string | null;
  title: string;
  snippet: string;
  snippet_norm: string;
  score: number;
};

export async function search(db: D1Database, query: string, opts: { limit?: number; kinds?: SearchKind[] } = {}): Promise<SearchResult[]> {
  const match = buildMatch(query);
  if (!match) return [];
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
  const kinds = opts.kinds && opts.kinds.length ? opts.kinds : (["note", "object", "pdf_page"] as SearchKind[]);
  const placeholders = kinds.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT d.key, d.doc_kind, d.doc_id, d.page, d.board_id, d.title,
              snippet(search_fts, 1, '<mark>', '</mark>', '…', 20) AS snippet,
              snippet(search_fts, 2, '<mark>', '</mark>', '…', 20) AS snippet_norm,
              bm25(search_fts, 4.0, 1.0, 1.0) AS score
       FROM search_fts JOIN search_docs d ON d.id = search_fts.rowid
       WHERE search_fts MATCH ? AND d.doc_kind IN (${placeholders})
       ORDER BY score LIMIT ?`,
    )
    .bind(match, ...kinds, limit)
    .all<Row>();
  const results = rows.results ?? [];
  if (!results.length) return [];

  // Boards: notes via cards; objects via their row; pdf pages via objects referencing the asset.
  const noteIds = results.filter((r) => r.doc_kind === "note").map((r) => r.doc_id);
  const objectIds = results.filter((r) => r.doc_kind === "object").map((r) => r.doc_id);
  const assetIds = results.filter((r) => r.doc_kind === "pdf_page").map((r) => r.doc_id);
  const boardsOf = new Map<string, Set<string>>();
  const objectKinds = new Map<string, ObjectKind>();
  const add = (k: string, b: string | null) => {
    if (!b) return;
    if (!boardsOf.has(k)) boardsOf.set(k, new Set());
    boardsOf.get(k)!.add(b);
  };
  const inList = (ids: string[]) => ids.map(() => "?").join(", ");
  if (noteIds.length) {
    const r = await db.prepare(`SELECT note_id, board_id FROM cards WHERE note_id IN (${inList(noteIds)})`).bind(...noteIds).all<{ note_id: string; board_id: string }>();
    for (const x of r.results ?? []) add(`note:${x.note_id}`, x.board_id);
  }
  if (objectIds.length) {
    const r = await db.prepare(`SELECT id, board_id, kind FROM objects WHERE id IN (${inList(objectIds)})`).bind(...objectIds).all<{ id: string; board_id: string; kind: ObjectKind }>();
    for (const x of r.results ?? []) {
      add(`object:${x.id}`, x.board_id);
      objectKinds.set(x.id, x.kind);
    }
  }
  if (assetIds.length) {
    const r = await db.prepare(`SELECT asset_id, board_id FROM objects WHERE asset_id IN (${inList(assetIds)})`).bind(...assetIds).all<{ asset_id: string; board_id: string }>();
    for (const x of r.results ?? []) add(`asset:${x.asset_id}`, x.board_id);
  }

  return results.map((r) => {
    const groupKey = r.doc_kind === "pdf_page" ? `asset:${r.doc_id}` : r.key;
    const out: SearchResult = {
      id: r.key,
      kind: r.doc_kind,
      title: r.title,
      // Prefer the original text; fall back to the diacritics-folded column when only it matched (e.g. đ vs d).
      snippet: r.snippet.includes("<mark>") ? r.snippet : r.snippet_norm,
      boardIds: Array.from(boardsOf.get(groupKey) ?? []),
      score: Number(r.score),
    };
    if (r.doc_kind === "object") out.objectKind = objectKinds.get(r.doc_id);
    if (r.doc_kind === "pdf_page") {
      out.page = r.page ?? undefined;
      out.assetId = r.doc_id;
    }
    return out;
  });
}
