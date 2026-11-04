import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../env";
import { clampInt, isFiniteNumber, newId, nowIso } from "../util";
import { indexStatement, removeStatement } from "../search";
import type { Asset, AssetKind } from "../../shared/types";

export type AssetRow = {
  id: string;
  kind: AssetKind;
  filename: string;
  content_type: string;
  size: number;
  r2_key: string;
  width: number | null;
  height: number | null;
  page_count: number | null;
  text_status: "none" | "pending" | "done";
  created_at: string;
};

export const toAsset = (r: AssetRow): Asset => ({
  id: r.id,
  kind: r.kind,
  filename: r.filename,
  contentType: r.content_type,
  size: r.size,
  url: `/api/assets/${r.id}`,
  width: r.width,
  height: r.height,
  pageCount: r.page_count,
  textStatus: r.text_status,
  createdAt: r.created_at,
});

export const LIMITS = { image: 10 * 1024 * 1024, pdf: 25 * 1024 * 1024 } as const;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_PAGES = 300;
const MAX_PAGE_TEXT = 50_000;

function kindFor(contentType: string): AssetKind | null {
  if (IMAGE_TYPES.has(contentType)) return "image";
  if (contentType === "application/pdf") return "pdf";
  return null;
}

export const assets = new Hono<AppEnv>();

const MAX_UPLOAD_BODY = LIMITS.pdf + 1024 * 1024;

// Streams the body and stops at the cap, so an oversized upload (with or without Content-Length) is never buffered.
const uploadBodyLimit = bodyLimit({
  maxSize: MAX_UPLOAD_BODY,
  onError: (c) => c.json({ error: "too_large", message: "File too large. Images up to 10 MB, PDFs up to 25 MB.", limit: LIMITS.pdf }, 413),
});

assets.post("/uploads", uploadBodyLimit, async (c) => {
  const ct = c.req.header("content-type") ?? "";
  if (!ct.includes("multipart/form-data")) return c.json({ error: "bad_request", message: "Send multipart/form-data with a `file` field." }, 400);

  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const file = form.file;
  if (!(file instanceof File)) return c.json({ error: "bad_request", message: "`file` field is required." }, 400);
  const type = (file.type || "").toLowerCase().split(";")[0];
  const kind = kindFor(type);
  if (!kind) return c.json({ error: "unsupported_type", message: "Only PNG, JPEG, GIF, WebP images and PDF files are accepted." }, 415);
  if (file.size > LIMITS[kind]) {
    const mb = Math.round(LIMITS[kind] / 1024 / 1024);
    return c.json({ error: "too_large", message: `${kind === "pdf" ? "PDFs" : "Images"} are limited to ${mb} MB.`, limit: LIMITS[kind] }, 413);
  }
  const id = newId();
  const safeName = (file.name || `${kind}`).replace(/[^\w.\- ()]+/g, "_").slice(0, 150);
  const key = `uploads/${id}/${safeName}`;
  await c.env.BUCKET.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: type } });
  const width = isFiniteNumber(Number(form.width)) && Number(form.width) > 0 ? Math.round(Number(form.width)) : null;
  const height = isFiniteNumber(Number(form.height)) && Number(form.height) > 0 ? Math.round(Number(form.height)) : null;
  const row: AssetRow = {
    id,
    kind,
    filename: safeName,
    content_type: type,
    size: file.size,
    r2_key: key,
    width: kind === "image" ? width : null,
    height: kind === "image" ? height : null,
    page_count: null,
    text_status: kind === "pdf" ? "pending" : "none",
    created_at: nowIso(),
  };
  await c.env.DB.prepare(
    "INSERT INTO assets (id, kind, filename, content_type, size, r2_key, width, height, page_count, text_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(row.id, row.kind, row.filename, row.content_type, row.size, row.r2_key, row.width, row.height, row.page_count, row.text_status, row.created_at)
    .run();
  return c.json(toAsset(row), 201);
});

assets.get("/assets/:id/meta", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM assets WHERE id = ?").bind(c.req.param("id")).first<AssetRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(toAsset(row));
});

assets.get("/assets/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM assets WHERE id = ?").bind(c.req.param("id")).first<AssetRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  const range = c.req.header("range");
  let obj: R2ObjectBody | null;
  try {
    obj = await c.env.BUCKET.get(row.r2_key, range ? { range: c.req.raw.headers } : undefined);
  } catch {
    return c.json({ error: "range_not_satisfiable" }, 416, { "content-range": `bytes */${row.size}` });
  }
  if (!obj) return c.json({ error: "not_found", message: "File missing from storage." }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("content-type", row.content_type);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("content-disposition", `inline; filename="${row.filename.replace(/"/g, "")}"`);
  let status = 200;
  if (range && obj.range && "suffix" in obj.range) {
    const length = Math.min(obj.range.suffix, obj.size);
    const start = obj.size - length;
    headers.set("content-range", `bytes ${start}-${obj.size - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    status = 206;
  } else if (range && obj.range && "offset" in obj.range) {
    const start = obj.range.offset ?? 0;
    const length = obj.range.length ?? obj.size - start;
    headers.set("content-range", `bytes ${start}-${start + length - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    status = 206;
  } else {
    headers.set("content-length", String(obj.size));
  }
  return new Response(obj.body, { status, headers });
});

assets.put("/assets/:id/text", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM assets WHERE id = ?").bind(id).first<AssetRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.kind !== "pdf") return c.json({ error: "bad_request", message: "Only PDF assets carry page text." }, 400);
  const body = ((await c.req.json().catch(() => ({}))) as Record<string, unknown>) ?? {};
  const pages = Array.isArray(body.pages) ? (body.pages as Record<string, unknown>[]) : null;
  if (!pages) return c.json({ error: "bad_request", message: "pages[] is required" }, 400);
  if (pages.length > MAX_PAGES) return c.json({ error: "bad_request", message: `At most ${MAX_PAGES} pages are indexed.` }, 400);
  const pageCount = isFiniteNumber(body.pageCount) ? Math.max(1, Math.trunc(body.pageCount)) : Math.max(pages.length, 1);
  const title = row.filename.replace(/\.pdf$/i, "");
  const objRows = await c.env.DB.prepare("SELECT title FROM objects WHERE asset_id = ? LIMIT 1").bind(id).first<{ title: string | null }>();
  const displayTitle = objRows?.title || title;

  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare("DELETE FROM asset_pages WHERE asset_id = ?").bind(id),
    removeStatement(c.env.DB, "pdf_page", id),
  ];
  let indexed = 0;
  for (const p of pages) {
    const page = isFiniteNumber(p.page) ? Math.trunc(p.page) : NaN;
    const text = typeof p.text === "string" ? p.text.slice(0, MAX_PAGE_TEXT) : "";
    if (!Number.isFinite(page) || page < 1) continue;
    stmts.push(c.env.DB.prepare("INSERT OR REPLACE INTO asset_pages (asset_id, page, text) VALUES (?, ?, ?)").bind(id, page, text));
    if (text.trim()) {
      stmts.push(indexStatement(c.env.DB, { kind: "pdf_page", docId: id, page, title: `${displayTitle} (p. ${page})`, body: text }));
      indexed += 1;
    }
  }
  stmts.push(c.env.DB.prepare("UPDATE assets SET page_count = ?, text_status = 'done' WHERE id = ?").bind(pageCount, id));
  stmts.push(c.env.DB.prepare("UPDATE objects SET meta = json_set(CASE WHEN json_valid(meta) THEN meta ELSE '{}' END, '$.pageCount', ?) WHERE asset_id = ?").bind(pageCount, id));
  for (let i = 0; i < stmts.length; i += 90) await c.env.DB.batch(stmts.slice(i, i + 90));
  return c.json({ indexed, pageCount });
});

assets.get("/assets/:id/text", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT page_count, kind FROM assets WHERE id = ?").bind(id).first<{ page_count: number | null; kind: string }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  const from = clampInt(c.req.query("from"), 1, 1, 100_000);
  const to = clampInt(c.req.query("to"), from + 49, from, from + 199);
  const pages = await c.env.DB.prepare("SELECT page, text FROM asset_pages WHERE asset_id = ? AND page BETWEEN ? AND ? ORDER BY page")
    .bind(id, from, to)
    .all<{ page: number; text: string }>();
  return c.json({ pages: pages.results ?? [], pageCount: row.page_count });
});

assets.delete("/assets/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT * FROM assets WHERE id = ?").bind(id).first<AssetRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  const used = await c.env.DB.prepare("SELECT id FROM objects WHERE asset_id = ? LIMIT 1").bind(id).first();
  if (used) return c.json({ error: "conflict", message: "An object on a board still uses this file." }, 409);
  await c.env.BUCKET.delete(row.r2_key);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM asset_pages WHERE asset_id = ?").bind(id),
    removeStatement(c.env.DB, "pdf_page", id),
    c.env.DB.prepare("DELETE FROM assets WHERE id = ?").bind(id),
  ]);
  return c.body(null, 204);
});
