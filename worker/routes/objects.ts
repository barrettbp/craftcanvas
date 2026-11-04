import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { isFiniteNumber, newId, nowIso } from "../util";
import { indexStatement, objectIndexDoc, removeStatement } from "../search";
import { youtubeMeta } from "../youtube";
import type { CanvasObject, ObjectKind } from "../../shared/types";

export type ObjectRow = {
  id: string;
  board_id: string;
  kind: ObjectKind;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  section_id: string | null;
  color: string | null;
  title: string | null;
  text: string | null;
  url: string | null;
  asset_id: string | null;
  meta: string;
  created_at: string;
  updated_at: string;
};

export function toObject(r: ObjectRow): CanvasObject {
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(r.meta || "{}") as Record<string, unknown>;
  } catch {
    meta = {};
  }
  return {
    id: r.id,
    boardId: r.board_id,
    kind: r.kind,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    z: r.z,
    sectionId: r.section_id,
    color: r.color,
    title: r.title,
    text: r.text,
    url: r.url,
    assetId: r.asset_id,
    meta,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const KINDS: ObjectKind[] = ["text", "card", "image", "pdf", "youtube"];
const DEFAULT_SIZE: Record<ObjectKind, [number, number]> = { text: [240, 80], card: [280, 180], image: [320, 240], pdf: [320, 420], youtube: [480, 270] };
const MAX_TEXT = 100_000;

const bad = (c: Context<AppEnv>, message: string, error = "bad_request") => c.json({ error, message }, 400);

async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const v = await c.req.json();
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function boardExists(c: Context<AppEnv>, id: string): Promise<boolean> {
  return !!(await c.env.DB.prepare("SELECT id FROM boards WHERE id = ?").bind(id).first());
}

async function touch(db: D1Database, boardId: string): Promise<void> {
  await db.prepare("UPDATE boards SET updated_at = ? WHERE id = ?").bind(nowIso(), boardId).run();
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);

export const objects = new Hono<AppEnv>();

objects.post("/boards/:id/objects", async (c) => {
  const boardId = c.req.param("id");
  if (!(await boardExists(c, boardId))) return c.json({ error: "not_found" }, 404);
  const body = await readJson(c);
  const kind = body.kind as ObjectKind;
  if (!KINDS.includes(kind)) return bad(c, `kind must be one of ${KINDS.join(", ")}`);
  if (!isFiniteNumber(body.x) || !isFiniteNumber(body.y)) return bad(c, "x and y are required");

  let title = str(body.title, 500);
  let text = str(body.text, MAX_TEXT);
  let url: string | null = null;
  let assetId: string | null = null;
  let meta: Record<string, unknown> = {};
  let [w, h] = DEFAULT_SIZE[kind];

  if (kind === "youtube") {
    const yt = typeof body.url === "string" ? await youtubeMeta(body.url) : null;
    if (!yt) return bad(c, "url must be a YouTube video URL", "invalid_url");
    url = yt.url;
    title = title ?? yt.title;
    meta = { videoId: yt.videoId, embedUrl: yt.embedUrl, author: yt.author, thumbnailUrl: yt.thumbnailUrl };
  }
  if (kind === "image" || kind === "pdf") {
    assetId = typeof body.assetId === "string" ? body.assetId : null;
    if (!assetId) return bad(c, "assetId is required for image and pdf objects");
    const asset = await c.env.DB.prepare("SELECT id, kind, filename, width, height, page_count FROM assets WHERE id = ?")
      .bind(assetId)
      .first<{ id: string; kind: string; filename: string; width: number | null; height: number | null; page_count: number | null }>();
    if (!asset) return c.json({ error: "not_found", message: "Asset not found." }, 404);
    if (asset.kind !== kind) return bad(c, `asset is a ${asset.kind}, not a ${kind}`);
    title = title ?? asset.filename;
    if (kind === "image") {
      meta = { width: asset.width, height: asset.height };
      if (asset.width && asset.height) {
        w = Math.min(480, asset.width);
        h = Math.round((w * asset.height) / asset.width);
      }
    } else meta = { pageCount: asset.page_count };
  }
  if (isFiniteNumber(body.w)) w = body.w;
  if (isFiniteNumber(body.h)) h = body.h;
  const color = str(body.color, 32);
  const sectionId = typeof body.sectionId === "string" ? body.sectionId : null;
  if (sectionId) {
    const s = await c.env.DB.prepare("SELECT id FROM sections WHERE id = ? AND board_id = ?").bind(sectionId, boardId).first();
    if (!s) return bad(c, "sectionId is not on this board");
  }

  const id = newId();
  const ts = nowIso();
  const zRow = await c.env.DB.prepare("SELECT COALESCE(MAX(z), 0) + 1 AS z FROM (SELECT z FROM cards WHERE board_id = ? UNION ALL SELECT z FROM objects WHERE board_id = ?)")
    .bind(boardId, boardId)
    .first<{ z: number }>();
  const obj: CanvasObject = { id, boardId, kind, x: body.x, y: body.y, w, h, z: zRow?.z ?? 1, sectionId, color, title, text, url, assetId, meta, createdAt: ts, updatedAt: ts };
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO objects (id, board_id, kind, x, y, w, h, z, section_id, color, title, text, url, asset_id, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, boardId, kind, obj.x, obj.y, w, h, obj.z, sectionId, color, title, text, url, assetId, JSON.stringify(meta), ts, ts),
    indexStatement(c.env.DB, objectIndexDoc(obj)),
  ]);
  await touch(c.env.DB, boardId);
  return c.json(obj, 201);
});

objects.patch("/boards/:id/objects/:objectId", async (c) => {
  const boardId = c.req.param("id");
  const objectId = c.req.param("objectId");
  const row = await c.env.DB.prepare("SELECT * FROM objects WHERE id = ? AND board_id = ?").bind(objectId, boardId).first<ObjectRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  const body = await readJson(c);
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const k of ["x", "y", "w", "h", "z"] as const) {
    if (isFiniteNumber(body[k])) {
      sets.push(`${k} = ?`);
      binds.push(body[k]);
    }
  }
  if (body.sectionId === null || typeof body.sectionId === "string") {
    if (typeof body.sectionId === "string") {
      const s = await c.env.DB.prepare("SELECT id FROM sections WHERE id = ? AND board_id = ?").bind(body.sectionId, boardId).first();
      if (!s) return bad(c, "sectionId is not on this board");
    }
    sets.push("section_id = ?");
    binds.push(body.sectionId);
  }
  if (body.color === null || typeof body.color === "string") {
    sets.push("color = ?");
    binds.push(str(body.color, 32));
  }
  let reindex = false;
  if (body.title === null || typeof body.title === "string") {
    sets.push("title = ?");
    binds.push(str(body.title, 500));
    reindex = true;
  }
  if (body.text === null || typeof body.text === "string") {
    sets.push("text = ?");
    binds.push(str(body.text, MAX_TEXT));
    reindex = true;
  }
  if (!sets.length) return bad(c, "nothing to update");
  sets.push("updated_at = ?");
  binds.push(nowIso(), objectId, boardId);
  await c.env.DB.prepare(`UPDATE objects SET ${sets.join(", ")} WHERE id = ? AND board_id = ?`)
    .bind(...binds)
    .run();
  const updated = toObject((await c.env.DB.prepare("SELECT * FROM objects WHERE id = ?").bind(objectId).first<ObjectRow>())!);
  if (reindex) await indexStatement(c.env.DB, objectIndexDoc(updated)).run();
  await touch(c.env.DB, boardId);
  return c.json(updated);
});

objects.put("/boards/:id/objects", async (c) => {
  const boardId = c.req.param("id");
  if (!(await boardExists(c, boardId))) return c.json({ error: "not_found" }, 404);
  const body = await readJson(c);
  const items = Array.isArray(body.objects) ? (body.objects as Record<string, unknown>[]) : null;
  if (!items) return bad(c, "objects[] is required");
  if (items.length > 500) return bad(c, "at most 500 objects per request");
  const sectionRows = await c.env.DB.prepare("SELECT id FROM sections WHERE board_id = ?").bind(boardId).all<{ id: string }>();
  const validSections = new Set((sectionRows.results ?? []).map((r) => r.id));
  const stmts: D1PreparedStatement[] = [];
  const ts = nowIso();
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
    if (it.sectionId === null || typeof it.sectionId === "string") {
      sets.push("section_id = ?");
      binds.push(typeof it.sectionId === "string" && validSections.has(it.sectionId) ? it.sectionId : null);
    }
    if (it.color === null || typeof it.color === "string") {
      sets.push("color = ?");
      binds.push(str(it.color, 32));
    }
    if (!sets.length) continue;
    sets.push("updated_at = ?");
    binds.push(ts, it.id, boardId);
    stmts.push(c.env.DB.prepare(`UPDATE objects SET ${sets.join(", ")} WHERE id = ? AND board_id = ?`).bind(...binds));
  }
  let updated = 0;
  for (let i = 0; i < stmts.length; i += 90) {
    const res = await c.env.DB.batch(stmts.slice(i, i + 90));
    for (const r of res) updated += r.meta.changes ?? 0;
  }
  if (stmts.length) await touch(c.env.DB, boardId);
  return c.json({ updated });
});

objects.delete("/boards/:id/objects/:objectId", async (c) => {
  const boardId = c.req.param("id");
  const objectId = c.req.param("objectId");
  const res = await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM arrows WHERE board_id = ? AND ((source_kind = 'object' AND source_id = ?) OR (target_kind = 'object' AND target_id = ?))").bind(boardId, objectId, objectId),
    c.env.DB.prepare("DELETE FROM objects WHERE id = ? AND board_id = ?").bind(objectId, boardId),
    removeStatement(c.env.DB, "object", objectId),
  ]);
  if (!res[1].meta.changes) return c.json({ error: "not_found" }, 404);
  await touch(c.env.DB, boardId);
  return c.body(null, 204);
});

/** YouTube preview before placing. */
objects.get("/youtube", async (c) => {
  const url = c.req.query("url") ?? "";
  const meta = await youtubeMeta(url);
  if (!meta) return c.json({ error: "invalid_url", message: "Not a YouTube video URL." }, 400);
  return c.json(meta);
});
