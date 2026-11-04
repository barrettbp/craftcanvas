import { Hono } from "hono";
import type { AppEnv } from "../env";
import { clampInt } from "../util";
import type { Folder, Link, Note, NoteSummary } from "../../shared/types";

type NoteRow = {
  id: string;
  title: string;
  folder_id: string | null;
  folder_name: string | null;
  preview: string;
  created_at: string | null;
  modified_at: string | null;
  deep_link_app: string;
  deep_link_web: string;
  link_count: number;
  backlink_count: number;
  markdown?: string;
};

type LinkRow = { source_note_id: string; target_note_id: string | null; target_block_id: string; label: string; out_of_scope: number };

export const SUMMARY_SELECT = `
  SELECT n.id, n.title, n.folder_id, n.folder_name, n.preview, n.created_at, n.modified_at, n.deep_link_app, n.deep_link_web,
    (SELECT COUNT(*) FROM links l WHERE l.source_note_id = n.id AND l.target_note_id IS NOT NULL) AS link_count,
    (SELECT COUNT(*) FROM links l WHERE l.target_note_id = n.id) AS backlink_count
  FROM notes n`;

export function rowToSummary(r: NoteRow): NoteSummary {
  return {
    id: r.id,
    title: r.title,
    folderId: r.folder_id,
    folderName: r.folder_name,
    preview: r.preview,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
    deepLinkApp: r.deep_link_app,
    deepLinkWeb: r.deep_link_web,
    linkCount: Number(r.link_count ?? 0),
    backlinkCount: Number(r.backlink_count ?? 0),
  };
}

export function rowToLink(r: LinkRow): Link {
  return {
    sourceNoteId: r.source_note_id,
    targetNoteId: r.target_note_id,
    targetBlockId: r.target_block_id,
    label: r.label,
    outOfScope: r.out_of_scope === 1,
  };
}

export const notes = new Hono<AppEnv>();

notes.get("/notes", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const folder = (c.req.query("folder") ?? "").trim();
  const limit = clampInt(c.req.query("limit"), 50, 1, 500);
  const offset = clampInt(c.req.query("offset"), 0, 0, 1_000_000);

  const where: string[] = ["n.deleted = 0"];
  const binds: unknown[] = [];
  if (q) {
    where.push("(n.title LIKE ? OR n.preview LIKE ?)");
    const like = `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    binds.push(like, like);
  }
  if (folder) {
    where.push("n.folder_id = ?");
    binds.push(folder);
  }
  const whereSql = ` WHERE ${where.join(" AND ")}`;
  const escapeSql = q ? " ESCAPE '\\'" : "";
  const listSql = `${SUMMARY_SELECT}${whereSql.replace(/LIKE \?/g, `LIKE ?${escapeSql}`)} ORDER BY n.modified_at DESC, n.title ASC LIMIT ? OFFSET ?`;
  const countSql = `SELECT COUNT(*) AS n FROM notes n${whereSql.replace(/LIKE \?/g, `LIKE ?${escapeSql}`)}`;

  const [list, count] = await Promise.all([
    c.env.DB.prepare(listSql)
      .bind(...binds, limit, offset)
      .all<NoteRow>(),
    c.env.DB.prepare(countSql)
      .bind(...binds)
      .first<{ n: number }>(),
  ]);
  return c.json({ items: (list.results ?? []).map(rowToSummary), total: count?.n ?? 0 });
});

notes.get("/notes/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`${SUMMARY_SELECT.replace("n.deep_link_web,", "n.deep_link_web, n.markdown,")} WHERE n.id = ? AND n.deleted = 0`)
    .bind(id)
    .first<NoteRow>();
  if (!row) return c.json({ error: "not_found", message: "Note not in cache." }, 404);

  const [outgoing, incoming, boards] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM links WHERE source_note_id = ? ORDER BY label").bind(id).all<LinkRow>(),
    c.env.DB.prepare("SELECT * FROM links WHERE target_note_id = ? ORDER BY source_note_id").bind(id).all<LinkRow>(),
    c.env.DB.prepare("SELECT c.id AS card_id, b.id AS board_id, b.name AS board_name FROM cards c JOIN boards b ON b.id = c.board_id WHERE c.note_id = ?")
      .bind(id)
      .all<{ card_id: string; board_id: string; board_name: string }>(),
  ]);

  const note: Note = {
    ...rowToSummary(row),
    markdown: row.markdown ?? "",
    outgoing: (outgoing.results ?? []).map(rowToLink),
    incoming: (incoming.results ?? []).map(rowToLink),
    boards: (boards.results ?? []).map((b) => ({ boardId: b.board_id, boardName: b.board_name, cardId: b.card_id })),
  };
  return c.json(note);
});

notes.get("/notes/:id/boards", async (c) => {
  const id = c.req.param("id");
  const rows = await c.env.DB.prepare(
    "SELECT c.id AS card_id, c.x, c.y, b.id AS board_id, b.name AS board_name FROM cards c JOIN boards b ON b.id = c.board_id WHERE c.note_id = ? ORDER BY b.name",
  )
    .bind(id)
    .all<{ card_id: string; x: number; y: number; board_id: string; board_name: string }>();
  return c.json({ items: (rows.results ?? []).map((r) => ({ boardId: r.board_id, boardName: r.board_name, cardId: r.card_id, x: r.x, y: r.y })) });
});

notes.get("/links", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT l.* FROM links l
     JOIN notes s ON s.id = l.source_note_id AND s.deleted = 0
     JOIN notes t ON t.id = l.target_note_id AND t.deleted = 0
     WHERE l.target_note_id IS NOT NULL`,
  ).all<LinkRow>();
  return c.json({ items: (rows.results ?? []).map(rowToLink) });
});

notes.get("/folders", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT folder_id AS id, folder_name AS name, COUNT(*) AS n FROM notes WHERE deleted = 0 AND folder_id IS NOT NULL GROUP BY folder_id, folder_name ORDER BY folder_name",
  ).all<{ id: string; name: string | null; n: number }>();
  const items: Folder[] = (rows.results ?? []).map((r) => ({ id: r.id, name: r.name ?? "", noteCount: Number(r.n) }));
  return c.json({ items });
});
