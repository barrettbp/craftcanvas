import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { newId, nowIso } from "../util";
import type { Arrow, ArrowEnd, ArrowEndKind, ArrowType } from "../../shared/types";

export type ArrowRow = {
  id: string;
  board_id: string;
  source_kind: ArrowEndKind;
  source_id: string;
  target_kind: ArrowEndKind;
  target_id: string;
  type: ArrowType;
  label: string | null;
  color: string | null;
  source_handle: string | null;
  target_handle: string | null;
  created_at: string;
};

export const toArrow = (r: ArrowRow): Arrow => ({
  id: r.id,
  boardId: r.board_id,
  source: { kind: r.source_kind, id: r.source_id },
  target: { kind: r.target_kind, id: r.target_id },
  type: r.type,
  label: r.label,
  color: r.color,
  sourceHandle: r.source_handle,
  targetHandle: r.target_handle,
  createdAt: r.created_at,
});

const TYPES: ArrowType[] = ["parent_child", "related", "custom"];

function parseEnd(v: unknown): ArrowEnd | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if ((o.kind !== "card" && o.kind !== "object") || typeof o.id !== "string" || !o.id) return null;
  return { kind: o.kind, id: o.id };
}

async function endOnBoard(db: D1Database, boardId: string, end: ArrowEnd): Promise<boolean> {
  const table = end.kind === "card" ? "cards" : "objects";
  return !!(await db.prepare(`SELECT id FROM ${table} WHERE id = ? AND board_id = ?`).bind(end.id, boardId).first());
}

async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const v = await c.req.json();
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const bad = (c: Context<AppEnv>, message: string) => c.json({ error: "bad_request", message }, 400);

async function touch(db: D1Database, boardId: string): Promise<void> {
  await db.prepare("UPDATE boards SET updated_at = ? WHERE id = ?").bind(nowIso(), boardId).run();
}

export const arrows = new Hono<AppEnv>();

arrows.post("/boards/:id/arrows", async (c) => {
  const boardId = c.req.param("id");
  if (!(await c.env.DB.prepare("SELECT id FROM boards WHERE id = ?").bind(boardId).first())) return c.json({ error: "not_found" }, 404);
  const body = await readJson(c);
  const source = parseEnd(body.source);
  const target = parseEnd(body.target);
  if (!source || !target) return bad(c, "source and target must be {kind: 'card'|'object', id}");
  if (source.kind === target.kind && source.id === target.id) return bad(c, "source and target must differ");
  if (!(await endOnBoard(c.env.DB, boardId, source)) || !(await endOnBoard(c.env.DB, boardId, target))) return bad(c, "both endpoints must be on this board");
  const type: ArrowType = TYPES.includes(body.type as ArrowType) ? (body.type as ArrowType) : "parent_child";
  const id = newId();
  const ts = nowIso();
  const row: ArrowRow = {
    id,
    board_id: boardId,
    source_kind: source.kind,
    source_id: source.id,
    target_kind: target.kind,
    target_id: target.id,
    type,
    label: str(body.label, 200),
    color: str(body.color, 32),
    source_handle: str(body.sourceHandle, 32),
    target_handle: str(body.targetHandle, 32),
    created_at: ts,
  };
  await c.env.DB.prepare(
    "INSERT INTO arrows (id, board_id, source_kind, source_id, target_kind, target_id, type, label, color, source_handle, target_handle, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(row.id, row.board_id, row.source_kind, row.source_id, row.target_kind, row.target_id, row.type, row.label, row.color, row.source_handle, row.target_handle, row.created_at)
    .run();
  await touch(c.env.DB, boardId);
  return c.json(toArrow(row), 201);
});

arrows.patch("/boards/:id/arrows/:arrowId", async (c) => {
  const boardId = c.req.param("id");
  const arrowId = c.req.param("arrowId");
  const row = await c.env.DB.prepare("SELECT * FROM arrows WHERE id = ? AND board_id = ?").bind(arrowId, boardId).first<ArrowRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  const body = await readJson(c);
  const sets: string[] = [];
  const binds: unknown[] = [];
  let source: ArrowEnd = { kind: row.source_kind, id: row.source_id };
  let target: ArrowEnd = { kind: row.target_kind, id: row.target_id };
  if (body.source !== undefined) {
    const e = parseEnd(body.source);
    if (!e || !(await endOnBoard(c.env.DB, boardId, e))) return bad(c, "source must be an endpoint on this board");
    source = e;
    sets.push("source_kind = ?", "source_id = ?");
    binds.push(e.kind, e.id);
  }
  if (body.target !== undefined) {
    const e = parseEnd(body.target);
    if (!e || !(await endOnBoard(c.env.DB, boardId, e))) return bad(c, "target must be an endpoint on this board");
    target = e;
    sets.push("target_kind = ?", "target_id = ?");
    binds.push(e.kind, e.id);
  }
  if (source.kind === target.kind && source.id === target.id) return bad(c, "source and target must differ");
  if (TYPES.includes(body.type as ArrowType)) {
    sets.push("type = ?");
    binds.push(body.type);
  }
  for (const [key, col, max] of [
    ["label", "label", 200],
    ["color", "color", 32],
    ["sourceHandle", "source_handle", 32],
    ["targetHandle", "target_handle", 32],
  ] as const) {
    if (body[key] === null || typeof body[key] === "string") {
      sets.push(`${col} = ?`);
      binds.push(str(body[key], max));
    }
  }
  if (!sets.length) return bad(c, "nothing to update");
  binds.push(arrowId, boardId);
  await c.env.DB.prepare(`UPDATE arrows SET ${sets.join(", ")} WHERE id = ? AND board_id = ?`)
    .bind(...binds)
    .run();
  await touch(c.env.DB, boardId);
  return c.json(toArrow((await c.env.DB.prepare("SELECT * FROM arrows WHERE id = ?").bind(arrowId).first<ArrowRow>())!));
});

arrows.delete("/boards/:id/arrows/:arrowId", async (c) => {
  const r = await c.env.DB.prepare("DELETE FROM arrows WHERE id = ? AND board_id = ?").bind(c.req.param("arrowId"), c.req.param("id")).run();
  if (!r.meta.changes) return c.json({ error: "not_found" }, 404);
  await touch(c.env.DB, c.req.param("id"));
  return c.body(null, 204);
});
