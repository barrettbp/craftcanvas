import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { isFiniteNumber, newId, nowIso } from "../util";
import { SUMMARY_SELECT, rowToSummary } from "./notes";
import type { Board, BoardDetail, Card, Connection, ConnectionKind, Section } from "../../shared/types";

type BoardRow = { id: string; name: string; viewport_x: number; viewport_y: number; viewport_zoom: number; created_at: string; updated_at: string; card_count?: number };
type CardRow = { id: string; board_id: string; note_id: string; x: number; y: number; w: number; h: number; folded: number; section_id: string | null; z: number; color: string | null };
type SectionRow = { id: string; board_id: string; name: string; x: number; y: number; w: number; h: number; color: string | null };
type ConnRow = { id: string; board_id: string; source_note_id: string; target_note_id: string; kind: ConnectionKind; label: string | null };

const toBoard = (r: BoardRow): Board => ({
  id: r.id,
  name: r.name,
  viewport: { x: r.viewport_x, y: r.viewport_y, zoom: r.viewport_zoom },
  cardCount: Number(r.card_count ?? 0),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toCard = (r: CardRow): Card => ({ id: r.id, boardId: r.board_id, noteId: r.note_id, x: r.x, y: r.y, w: r.w, h: r.h, folded: r.folded === 1, sectionId: r.section_id, z: r.z, color: r.color ?? null });
const toSection = (r: SectionRow): Section => ({ id: r.id, boardId: r.board_id, name: r.name, x: r.x, y: r.y, w: r.w, h: r.h, color: r.color });
const toConn = (r: ConnRow): Connection => ({ id: r.id, boardId: r.board_id, sourceNoteId: r.source_note_id, targetNoteId: r.target_note_id, kind: r.kind, label: r.label });

const BOARD_SELECT = "SELECT b.*, (SELECT COUNT(*) FROM cards c WHERE c.board_id = b.id) AS card_count FROM boards b";

const bad = (c: Context<AppEnv>, message: string) => c.json({ error: "bad_request", message }, 400);

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const v = await c.req.json();
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function boardOr404(c: Context<AppEnv>, id: string): Promise<BoardRow | null> {
  return c.env.DB.prepare(`${BOARD_SELECT} WHERE b.id = ?`).bind(id).first<BoardRow>();
}

async function touch(db: D1Database, boardId: string): Promise<void> {
  await db.prepare("UPDATE boards SET updated_at = ? WHERE id = ?").bind(nowIso(), boardId).run();
}

export const boards = new Hono<AppEnv>();

boards.get("/boards", async (c) => {
  const rows = await c.env.DB.prepare(`${BOARD_SELECT} ORDER BY b.updated_at DESC`).all<BoardRow>();
  return c.json({ items: (rows.results ?? []).map(toBoard) });
});

boards.post("/boards", async (c) => {
  const body = await readJson(c);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return bad(c, "name is required");
  const id = newId();
  const ts = nowIso();
  await c.env.DB.prepare("INSERT INTO boards (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(id, name, ts, ts).run();
  const row = await boardOr404(c, id);
  return c.json(toBoard(row!), 201);
});

boards.get("/boards/:id", async (c) => {
  const id = c.req.param("id");
  const row = await boardOr404(c, id);
  if (!row) return c.json({ error: "not_found" }, 404);
  const [cards, sections, conns, notes] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM cards WHERE board_id = ? ORDER BY z, id").bind(id).all<CardRow>(),
    c.env.DB.prepare("SELECT * FROM sections WHERE board_id = ? ORDER BY id").bind(id).all<SectionRow>(),
    c.env.DB.prepare("SELECT * FROM connections WHERE board_id = ? ORDER BY id").bind(id).all<ConnRow>(),
    c.env.DB.prepare(`${SUMMARY_SELECT} WHERE n.id IN (SELECT note_id FROM cards WHERE board_id = ?)`).bind(id).all(),
  ]);
  const detail: BoardDetail = {
    ...toBoard(row),
    cards: (cards.results ?? []).map(toCard),
    sections: (sections.results ?? []).map(toSection),
    connections: (conns.results ?? []).map(toConn),
    notes: (notes.results ?? []).map((r) => rowToSummary(r as never)),
  };
  return c.json(detail);
});

boards.patch("/boards/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await boardOr404(c, id))) return c.json({ error: "not_found" }, 404);
  const body = await readJson(c);
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.name === "string" && body.name.trim()) {
    sets.push("name = ?");
    binds.push(body.name.trim().slice(0, 120));
  }
  const vp = body.viewport as Record<string, unknown> | undefined;
  if (vp && isFiniteNumber(vp.x) && isFiniteNumber(vp.y) && isFiniteNumber(vp.zoom)) {
    sets.push("viewport_x = ?", "viewport_y = ?", "viewport_zoom = ?");
    binds.push(vp.x, vp.y, Math.min(10, Math.max(0.01, vp.zoom)));
  }
  if (!sets.length) return bad(c, "nothing to update");
  sets.push("updated_at = ?");
  binds.push(nowIso(), id);
  await c.env.DB.prepare(`UPDATE boards SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  return c.json(toBoard((await boardOr404(c, id))!));
});

boards.delete("/boards/:id", async (c) => {
  const id = c.req.param("id");
  const r = await c.env.DB.prepare("DELETE FROM boards WHERE id = ?").bind(id).run();
  if (!r.meta.changes) return c.json({ error: "not_found" }, 404);
  // D1 enforces foreign keys, but be explicit in case PRAGMA differs locally.
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM cards WHERE board_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM sections WHERE board_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM connections WHERE board_id = ?").bind(id),
  ]);
  return c.body(null, 204);
});

// ---------- cards ----------

boards.post("/boards/:id/cards", async (c) => {
  const boardId = c.req.param("id");
  if (!(await boardOr404(c, boardId))) return c.json({ error: "not_found" }, 404);
  const body = await readJson(c);
  const noteId = typeof body.noteId === "string" ? body.noteId : "";
  if (!noteId || !isFiniteNumber(body.x) || !isFiniteNumber(body.y)) return bad(c, "noteId, x and y are required");
  const note = await c.env.DB.prepare("SELECT id FROM notes WHERE id = ? AND deleted = 0").bind(noteId).first();
  if (!note) return c.json({ error: "not_found", message: "Note not in cache." }, 404);
  const dup = await c.env.DB.prepare("SELECT id FROM cards WHERE board_id = ? AND note_id = ?").bind(boardId, noteId).first<{ id: string }>();
  if (dup) return c.json({ error: "conflict", message: "Note is already on this board.", cardId: dup.id }, 409);
  const id = newId();
  const w = isFiniteNumber(body.w) ? body.w : 260;
  const h = isFiniteNumber(body.h) ? body.h : 160;
  const zRow = await c.env.DB.prepare("SELECT COALESCE(MAX(z), 0) + 1 AS z FROM cards WHERE board_id = ?").bind(boardId).first<{ z: number }>();
  const color = typeof body.color === "string" ? body.color.slice(0, 32) : null;
  await c.env.DB.prepare("INSERT INTO cards (id, board_id, note_id, x, y, w, h, folded, section_id, z, color) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)")
    .bind(id, boardId, noteId, body.x, body.y, w, h, zRow?.z ?? 1, color)
    .run();
  await touch(c.env.DB, boardId);
  const row = await c.env.DB.prepare("SELECT * FROM cards WHERE id = ?").bind(id).first<CardRow>();
  return c.json(toCard(row!), 201);
});

boards.put("/boards/:id/cards", async (c) => {
  const boardId = c.req.param("id");
  if (!(await boardOr404(c, boardId))) return c.json({ error: "not_found" }, 404);
  const body = await readJson(c);
  const items = Array.isArray(body.cards) ? (body.cards as Record<string, unknown>[]) : null;
  if (!items) return bad(c, "cards[] is required");
  if (items.length > 500) return bad(c, "at most 500 cards per request");
  // A stale sectionId (section deleted while a debounced update was in flight) must not fail the batch.
  const sectionRows = await c.env.DB.prepare("SELECT id FROM sections WHERE board_id = ?").bind(boardId).all<{ id: string }>();
  const validSections = new Set((sectionRows.results ?? []).map((r) => r.id));
  const stmts: D1PreparedStatement[] = [];
  for (const it of items) {
    if (typeof it.id !== "string") continue;
    const sets: string[] = [];
    const binds: unknown[] = [];
    for (const k of ["x", "y", "w", "h", "z"] as const) {
      if (isFiniteNumber(it[k])) {
        sets.push(`${k} = ?`);
        binds.push(it[k]);
      }
    }
    if (typeof it.folded === "boolean") {
      sets.push("folded = ?");
      binds.push(it.folded ? 1 : 0);
    }
    if (it.sectionId === null || typeof it.sectionId === "string") {
      sets.push("section_id = ?");
      binds.push(typeof it.sectionId === "string" && validSections.has(it.sectionId) ? it.sectionId : null);
    }
    if (it.color === null || typeof it.color === "string") {
      sets.push("color = ?");
      binds.push(it.color === null ? null : String(it.color).slice(0, 32));
    }
    if (!sets.length) continue;
    binds.push(it.id, boardId);
    stmts.push(c.env.DB.prepare(`UPDATE cards SET ${sets.join(", ")} WHERE id = ? AND board_id = ?`).bind(...binds));
  }
  let updated = 0;
  for (let i = 0; i < stmts.length; i += 90) {
    const res = await c.env.DB.batch(stmts.slice(i, i + 90));
    for (const r of res) updated += r.meta.changes ?? 0;
  }
  if (stmts.length) await touch(c.env.DB, boardId);
  return c.json({ updated });
});

boards.delete("/boards/:id/cards/:cardId", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM cards WHERE id = ? AND board_id = ?").bind(c.req.param("cardId"), c.req.param("id")).run();
  if (!r.meta.changes) return c.json({ error: "not_found" }, 404);
  await touch(c.env.DB, c.req.param("id"));
  return c.body(null, 204);
});

// ---------- sections ----------

boards.post("/boards/:id/sections", async (c) => {
  const boardId = c.req.param("id");
  if (!(await boardOr404(c, boardId))) return c.json({ error: "not_found" }, 404);
  const body = await readJson(c);
  if (!isFiniteNumber(body.x) || !isFiniteNumber(body.y) || !isFiniteNumber(body.w) || !isFiniteNumber(body.h)) return bad(c, "x, y, w, h are required");
  const id = newId();
  const name = typeof body.name === "string" ? body.name.slice(0, 120) : "";
  const color = typeof body.color === "string" ? body.color.slice(0, 32) : null;
  await c.env.DB.prepare("INSERT INTO sections (id, board_id, name, x, y, w, h, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, boardId, name, body.x, body.y, body.w, body.h, color)
    .run();
  await touch(c.env.DB, boardId);
  const row = await c.env.DB.prepare("SELECT * FROM sections WHERE id = ?").bind(id).first<SectionRow>();
  return c.json(toSection(row!), 201);
});

boards.patch("/boards/:id/sections/:sectionId", async (c) => {
  const boardId = c.req.param("id");
  const sectionId = c.req.param("sectionId");
  const body = await readJson(c);
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const k of ["x", "y", "w", "h"] as const) {
    if (isFiniteNumber(body[k])) {
      sets.push(`${k} = ?`);
      binds.push(body[k]);
    }
  }
  if (typeof body.name === "string") {
    sets.push("name = ?");
    binds.push(body.name.slice(0, 120));
  }
  if (body.color === null || typeof body.color === "string") {
    sets.push("color = ?");
    binds.push(body.color === null ? null : String(body.color).slice(0, 32));
  }
  if (!sets.length) return bad(c, "nothing to update");
  binds.push(sectionId, boardId);
  const r = await c.env.DB.prepare(`UPDATE sections SET ${sets.join(", ")} WHERE id = ? AND board_id = ?`)
    .bind(...binds)
    .run();
  if (!r.meta.changes) return c.json({ error: "not_found" }, 404);
  await touch(c.env.DB, boardId);
  const row = await c.env.DB.prepare("SELECT * FROM sections WHERE id = ?").bind(sectionId).first<SectionRow>();
  return c.json(toSection(row!));
});

boards.delete("/boards/:id/sections/:sectionId", async (c) => {
  const boardId = c.req.param("id");
  const sectionId = c.req.param("sectionId");
  const res = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE cards SET section_id = NULL WHERE section_id = ? AND board_id = ?").bind(sectionId, boardId),
    c.env.DB.prepare("DELETE FROM sections WHERE id = ? AND board_id = ?").bind(sectionId, boardId),
  ]);
  if (!res[1].meta.changes) return c.json({ error: "not_found" }, 404);
  await touch(c.env.DB, boardId);
  return c.body(null, 204);
});

// ---------- connections (board-only edges) ----------

boards.post("/boards/:id/connections", async (c) => {
  const boardId = c.req.param("id");
  if (!(await boardOr404(c, boardId))) return c.json({ error: "not_found" }, 404);
  const body = await readJson(c);
  const s = typeof body.sourceNoteId === "string" ? body.sourceNoteId : "";
  const t = typeof body.targetNoteId === "string" ? body.targetNoteId : "";
  if (!s || !t || s === t) return bad(c, "sourceNoteId and targetNoteId are required and must differ");
  const kind: ConnectionKind = body.kind === "accepted" || body.kind === "suggested" ? body.kind : "manual";
  const label = typeof body.label === "string" ? body.label.slice(0, 120) : null;
  const id = newId();
  await c.env.DB.prepare("INSERT INTO connections (id, board_id, source_note_id, target_note_id, kind, label) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, boardId, s, t, kind, label)
    .run();
  await touch(c.env.DB, boardId);
  const row = await c.env.DB.prepare("SELECT * FROM connections WHERE id = ?").bind(id).first<ConnRow>();
  return c.json(toConn(row!), 201);
});

boards.delete("/boards/:id/connections/:connectionId", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM connections WHERE id = ? AND board_id = ?").bind(c.req.param("connectionId"), c.req.param("id")).run();
  if (!r.meta.changes) return c.json({ error: "not_found" }, 404);
  await touch(c.env.DB, c.req.param("id"));
  return c.body(null, 204);
});
