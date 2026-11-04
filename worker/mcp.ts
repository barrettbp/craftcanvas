/**
 * Read-only MCP server (Streamable HTTP, stateless) exposing boards, objects, arrows, Craft notes,
 * PDF pages and full-text search. Tool outputs follow ChatGPT's search/fetch shapes (id, title, text, url)
 * so both Claude and ChatGPT can cite sources.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Bindings } from "./env";
import { search as runSearch } from "./search";
import { toObject, type ObjectRow } from "./routes/objects";
import { toArrow, type ArrowRow } from "./routes/arrows";
import { SUMMARY_SELECT, rowToSummary } from "./routes/notes";
import type { Arrow, SearchKind } from "../shared/types";

type Ctx = { env: Bindings; origin: string };

const text = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data as Record<string, unknown> });
const notFound = (what: string) => ({ content: [{ type: "text" as const, text: `not found: ${what}` }], isError: true });

/** Cap for PDF text in a single fetch; beyond this the client should page with get_pdf_pages. */
const FETCH_PDF_PAGES = 10;
const FETCH_TEXT_CHARS = 60_000;
const PAGES_TEXT_CHARS = 100_000;
/** Default and maximum size of the `text` field returned by fetch; longer items are paged with `offset`. */
const FETCH_DEFAULT_CHARS = 20_000;
const FETCH_MAX_CHARS = 60_000;

/** Slice an item's text for paging and annotate the result. */
function pageText(item: Record<string, unknown>, offset: number, maxChars: number): Record<string, unknown> {
  const full = typeof item.text === "string" ? item.text : "";
  const start = Math.min(Math.max(0, offset), full.length);
  const end = Math.min(full.length, start + maxChars);
  const truncated = end < full.length;
  return {
    ...item,
    text: full.slice(start, end),
    textRange: { offset: start, length: end - start, totalChars: full.length, truncated, nextOffset: truncated ? end : null },
  };
}

function joinPages(pages: { page: number; text: string }[], maxChars: number): { text: string; included: number; truncated: boolean } {
  let out = "";
  let included = 0;
  for (const p of pages) {
    const chunk = `--- page ${p.page} ---\n${p.text}\n\n`;
    if (out.length + chunk.length > maxChars) return { text: out, included, truncated: true };
    out += chunk;
    included += 1;
  }
  return { text: out.trimEnd(), included, truncated: false };
}

/** Run a query per chunk of ids so D1's 100-bound-parameter limit is never hit. */
async function chunked<T>(ids: string[], run: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 90) out.push(...(await run(ids.slice(i, i + 90))));
  return out;
}

function itemUrl(origin: string, boardId: string | null, id: string): string {
  return boardId ? `${origin}/#/board/${encodeURIComponent(boardId)}?focus=${encodeURIComponent(id)}` : `${origin}/`;
}

async function boardsOfNote(env: Bindings, noteId: string): Promise<{ boardId: string; boardName: string; cardId: string }[]> {
  const r = await env.DB.prepare("SELECT c.id AS card_id, b.id AS board_id, b.name AS board_name FROM cards c JOIN boards b ON b.id = c.board_id WHERE c.note_id = ?")
    .bind(noteId)
    .all<{ card_id: string; board_id: string; board_name: string }>();
  return (r.results ?? []).map((x) => ({ boardId: x.board_id, boardName: x.board_name, cardId: x.card_id }));
}

async function arrowsTouching(env: Bindings, kind: "card" | "object", id: string): Promise<Arrow[]> {
  const r = await env.DB.prepare("SELECT * FROM arrows WHERE (source_kind = ? AND source_id = ?) OR (target_kind = ? AND target_id = ?)").bind(kind, id, kind, id).all<ArrowRow>();
  return (r.results ?? []).map(toArrow);
}

/** Resolve arrow endpoints to readable labels: card → its note title, object → its title/kind. */
async function describeArrows(env: Bindings, arrows: Arrow[]) {
  const cardIds = new Set<string>();
  const objectIds = new Set<string>();
  for (const a of arrows) for (const e of [a.source, a.target]) (e.kind === "card" ? cardIds : objectIds).add(e.id);
  const names = new Map<string, { title: string; itemId: string; kind: string }>();
  const cardRows = await chunked(Array.from(cardIds), async (ids) =>
    (await env.DB.prepare(`SELECT c.id, c.note_id, n.title FROM cards c JOIN notes n ON n.id = c.note_id WHERE c.id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string; note_id: string; title: string }>()).results ?? [],
  );
  for (const x of cardRows) names.set(`card:${x.id}`, { title: x.title, itemId: `note:${x.note_id}`, kind: "note" });
  const objectRows = await chunked(Array.from(objectIds), async (ids) =>
    (await env.DB.prepare(`SELECT id, kind, title, text FROM objects WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string; kind: string; title: string | null; text: string | null }>()).results ?? [],
  );
  for (const x of objectRows) names.set(`object:${x.id}`, { title: x.title || (x.text ?? "").slice(0, 60) || x.kind, itemId: `object:${x.id}`, kind: x.kind });
  return arrows.map((a) => {
    const from = names.get(`${a.source.kind}:${a.source.id}`);
    const to = names.get(`${a.target.kind}:${a.target.id}`);
    return {
      id: a.id,
      boardId: a.boardId,
      type: a.type,
      label: a.label,
      direction: "from → to" + (a.type === "parent_child" ? " (parent → child)" : ""),
      from: { id: from?.itemId ?? `${a.source.kind}:${a.source.id}`, title: from?.title ?? null, kind: from?.kind ?? a.source.kind },
      to: { id: to?.itemId ?? `${a.target.kind}:${a.target.id}`, title: to?.title ?? null, kind: to?.kind ?? a.target.kind },
    };
  });
}

async function getBoard(ctx: Ctx, boardId: string) {
  const { env, origin } = ctx;
  const board = await env.DB.prepare("SELECT id, name, created_at, updated_at FROM boards WHERE id = ?").bind(boardId).first<{ id: string; name: string; created_at: string; updated_at: string }>();
  if (!board) return null;
  const [cards, objects, sections, arrows] = await Promise.all([
    env.DB.prepare(`SELECT c.id AS card_id, c.x, c.y, c.section_id, n.id, n.title, n.preview, n.deep_link_web FROM cards c JOIN notes n ON n.id = c.note_id WHERE c.board_id = ? ORDER BY c.y, c.x`).bind(boardId).all<{ card_id: string; x: number; y: number; section_id: string | null; id: string; title: string; preview: string; deep_link_web: string }>(),
    env.DB.prepare("SELECT * FROM objects WHERE board_id = ? ORDER BY y, x").bind(boardId).all<ObjectRow>(),
    env.DB.prepare("SELECT id, name, x, y, w, h FROM sections WHERE board_id = ?").bind(boardId).all<{ id: string; name: string; x: number; y: number; w: number; h: number }>(),
    env.DB.prepare("SELECT * FROM arrows WHERE board_id = ?").bind(boardId).all<ArrowRow>(),
  ]);
  const linkRows = await env.DB.prepare(
    `SELECT source_note_id, target_note_id, label FROM links
     WHERE target_note_id IS NOT NULL
       AND source_note_id IN (SELECT note_id FROM cards WHERE board_id = ?)
       AND target_note_id IN (SELECT note_id FROM cards WHERE board_id = ?)`,
  )
    .bind(boardId, boardId)
    .all<{ source_note_id: string; target_note_id: string; label: string }>();
  const craftLinks = (linkRows.results ?? []).map((l) => ({ from: `note:${l.source_note_id}`, to: `note:${l.target_note_id}`, label: l.label }));
  const items = [
    ...(cards.results ?? []).map((c) => ({ id: `note:${c.id}`, cardId: c.card_id, kind: "note", title: c.title, preview: c.preview, x: c.x, y: c.y, sectionId: c.section_id, url: c.deep_link_web || itemUrl(origin, boardId, c.card_id) })),
    ...(objects.results ?? []).map(toObject).map((o) => ({
      id: `object:${o.id}`,
      kind: o.kind,
      title: o.title,
      preview: (o.text ?? "").slice(0, 280),
      x: o.x,
      y: o.y,
      sectionId: o.sectionId,
      url: o.kind === "youtube" && o.url ? o.url : itemUrl(origin, boardId, o.id),
      assetId: o.assetId,
    })),
  ];
  return {
    board: { id: board.id, name: board.name, createdAt: board.created_at, updatedAt: board.updated_at, url: itemUrl(origin, boardId, "") },
    items,
    sections: sections.results ?? [],
    arrows: await describeArrows(env, (arrows.results ?? []).map(toArrow)),
    craftLinks,
  };
}

async function fetchItem(ctx: Ctx, rawId: string): Promise<Record<string, unknown> | null> {
  const { env, origin } = ctx;
  const [prefix, ...rest] = rawId.split(":");
  const id = rest.join(":");
  if (prefix === "board") return getBoard(ctx, id);
  if (prefix === "card") {
    const card = await env.DB.prepare("SELECT note_id FROM cards WHERE id = ?").bind(id).first<{ note_id: string }>();
    return card ? fetchItem(ctx, `note:${card.note_id}`) : null;
  }
  if (prefix === "note") {
    const row = await env.DB.prepare(`${SUMMARY_SELECT.replace("n.deep_link_web,", "n.deep_link_web, n.markdown,")} WHERE n.id = ? AND n.deleted = 0`).bind(id).first<Record<string, unknown>>();
    if (!row) return null;
    const summary = rowToSummary(row as never);
    const [outgoing, incoming, boards] = await Promise.all([
      env.DB.prepare("SELECT l.target_note_id, l.label, n.title FROM links l JOIN notes n ON n.id = l.target_note_id WHERE l.source_note_id = ? AND n.deleted = 0").bind(id).all<{ target_note_id: string; label: string; title: string }>(),
      env.DB.prepare("SELECT l.source_note_id, l.label, n.title FROM links l JOIN notes n ON n.id = l.source_note_id WHERE l.target_note_id = ? AND n.deleted = 0").bind(id).all<{ source_note_id: string; label: string; title: string }>(),
      boardsOfNote(env, id),
    ]);
    const cardArrows = (await Promise.all(boards.map((b) => arrowsTouching(env, "card", b.cardId)))).flat();
    return {
      id: `note:${id}`,
      kind: "note",
      title: summary.title,
      text: String(row.markdown ?? ""),
      url: summary.deepLinkWeb || itemUrl(origin, boards[0]?.boardId ?? null, boards[0]?.cardId ?? id),
      metadata: {
        source: "Craft (read-only)",
        folder: summary.folderName,
        createdAt: summary.createdAt,
        modifiedAt: summary.modifiedAt,
        openInCraft: summary.deepLinkApp,
        boards,
        craftLinksOut: (outgoing.results ?? []).map((l) => ({ id: `note:${l.target_note_id}`, title: l.title, label: l.label })),
        craftLinksIn: (incoming.results ?? []).map((l) => ({ id: `note:${l.source_note_id}`, title: l.title, label: l.label })),
        arrows: await describeArrows(env, cardArrows),
      },
    };
  }
  if (prefix === "object") {
    const row = await env.DB.prepare("SELECT * FROM objects WHERE id = ?").bind(id).first<ObjectRow>();
    if (!row) return null;
    const o = toObject(row);
    let body = o.text ?? "";
    let pdfInfo: Record<string, unknown> = {};
    if (o.kind === "pdf" && o.assetId) {
      const r = await env.DB.prepare("SELECT page, text FROM asset_pages WHERE asset_id = ? ORDER BY page LIMIT ?").bind(o.assetId, FETCH_PDF_PAGES + 1).all<{ page: number; text: string }>();
      const joined = joinPages((r.results ?? []).slice(0, FETCH_PDF_PAGES), FETCH_TEXT_CHARS);
      const truncated = joined.truncated || (r.results ?? []).length > FETCH_PDF_PAGES;
      body = joined.text;
      pdfInfo = { pagesIncluded: joined.included, truncated, next: truncated ? `get_pdf_pages with assetId ${o.assetId} from ${joined.included + 1}` : undefined };
    }
    return {
      id: `object:${o.id}`,
      kind: o.kind,
      title: o.title ?? (o.kind === "text" ? (o.text ?? "").slice(0, 80) : o.kind),
      text: body,
      url: o.kind === "youtube" && o.url ? o.url : itemUrl(origin, o.boardId, o.id),
      metadata: {
        source: "CraftCanvas (local)",
        boardId: o.boardId,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        assetId: o.assetId,
        assetUrl: o.assetId ? `${origin}/api/assets/${o.assetId}` : null,
        caption: o.kind === "pdf" || o.kind === "image" ? o.text : undefined,
        ...o.meta,
        ...pdfInfo,
        arrows: await describeArrows(env, await arrowsTouching(env, "object", o.id)),
      },
    };
  }
  if (prefix === "asset" || prefix === "pdf_page") {
    const [assetId, pageStr] = prefix === "pdf_page" ? [rest[0], rest[1]] : [id, undefined];
    const asset = await env.DB.prepare("SELECT id, kind, filename, page_count FROM assets WHERE id = ?").bind(assetId).first<{ id: string; kind: string; filename: string; page_count: number | null }>();
    if (!asset) return null;
    const page = pageStr ? parseInt(pageStr, 10) : null;
    const r = page
      ? await env.DB.prepare("SELECT page, text FROM asset_pages WHERE asset_id = ? AND page = ?").bind(assetId, page).all<{ page: number; text: string }>()
      : await env.DB.prepare("SELECT page, text FROM asset_pages WHERE asset_id = ? ORDER BY page LIMIT ?").bind(assetId, FETCH_PDF_PAGES + 1).all<{ page: number; text: string }>();
    const all = r.results ?? [];
    const joined = joinPages(all.slice(0, page ? 1 : FETCH_PDF_PAGES), FETCH_TEXT_CHARS);
    const truncated = joined.truncated || (!page && all.length > FETCH_PDF_PAGES);
    const objs = await env.DB.prepare("SELECT id, board_id, title FROM objects WHERE asset_id = ?").bind(assetId).all<{ id: string; board_id: string; title: string | null }>();
    const first = (objs.results ?? [])[0];
    return {
      id: page ? `pdf_page:${assetId}:${page}` : `asset:${assetId}`,
      kind: asset.kind === "pdf" ? (page ? "pdf_page" : "pdf") : "image",
      title: (first?.title || asset.filename) + (page ? ` (p. ${page})` : ""),
      text: joined.text,
      url: `${origin}/api/assets/${assetId}${page ? `#page=${page}` : ""}`,
      metadata: { source: "CraftCanvas upload", filename: asset.filename, pageCount: asset.page_count, page, pagesIncluded: joined.included, truncated, next: truncated ? `get_pdf_pages with assetId ${assetId} from ${joined.included + 1}` : undefined, boards: (objs.results ?? []).map((o) => ({ boardId: o.board_id, objectId: `object:${o.id}` })) },
    };
  }
  return null;
}

function searchUrl(ctx: Ctx, r: { id: string; kind: SearchKind; boardIds: string[]; assetId?: string; page?: number }): string {
  if (r.kind === "pdf_page") return `${ctx.origin}/api/assets/${r.assetId}#page=${r.page}`;
  const rawId = r.id.split(":").slice(1).join(":");
  return itemUrl(ctx.origin, r.boardIds[0] ?? null, rawId);
}

export function buildMcpServer(ctx: Ctx): McpServer {
  const server = new McpServer({ name: "craftcanvas", version: "2.0.0" });
  const ro = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

  server.registerTool(
    "list_boards",
    { description: "List every canvas board with counts of Craft note cards, local objects and arrows.", inputSchema: {}, annotations: ro },
    async () => {
      const r = await ctx.env.DB.prepare(
        `SELECT b.id, b.name, b.updated_at,
           (SELECT COUNT(*) FROM cards c WHERE c.board_id = b.id) AS card_count,
           (SELECT COUNT(*) FROM objects o WHERE o.board_id = b.id) AS object_count,
           (SELECT COUNT(*) FROM arrows a WHERE a.board_id = b.id) AS arrow_count
         FROM boards b ORDER BY b.updated_at DESC`,
      ).all<{ id: string; name: string; updated_at: string; card_count: number; object_count: number; arrow_count: number }>();
      return text({ boards: (r.results ?? []).map((b) => ({ id: `board:${b.id}`, name: b.name, cardCount: b.card_count, objectCount: b.object_count, arrowCount: b.arrow_count, updatedAt: b.updated_at, url: itemUrl(ctx.origin, b.id, "") })) });
    },
  );

  server.registerTool(
    "get_board",
    { description: "Read one board: its items (Craft note cards and local text/card/image/pdf/youtube objects with positions), sections, arrows with type/label/direction, and Craft links between notes on it.", inputSchema: { boardId: z.string().describe("Board id, with or without the 'board:' prefix") }, annotations: ro },
    async ({ boardId }) => {
      const b = await getBoard(ctx, boardId.replace(/^board:/, ""));
      return b ? text(b) : notFound(boardId);
    },
  );

  server.registerTool(
    "search",
    {
      description: "Full-text search across Craft notes, canvas cards and text, and uploaded PDF pages. Diacritics are folded (\"viet\" finds \"Việt\"). Returns ids usable with fetch.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
        kinds: z.array(z.enum(["note", "object", "pdf_page"])).optional(),
      },
      annotations: ro,
    },
    async ({ query, limit, kinds }) => {
      const results = await runSearch(ctx.env.DB, query, { limit: limit ?? 20, kinds });
      // Craft notes cite their Craft web link when the cache has one.
      const noteIds = results.filter((r) => r.kind === "note").map((r) => r.id.slice(5));
      const craftUrls = new Map<string, string>();
      if (noteIds.length) {
        const rows = await ctx.env.DB.prepare(`SELECT id, deep_link_web FROM notes WHERE id IN (${noteIds.map(() => "?").join(",")})`).bind(...noteIds).all<{ id: string; deep_link_web: string }>();
        for (const n of rows.results ?? []) if (n.deep_link_web) craftUrls.set(n.id, n.deep_link_web);
      }
      return text({
        results: results.map((r) => ({
          id: r.id,
          title: r.title,
          url: (r.kind === "note" && craftUrls.get(r.id.slice(5))) || searchUrl(ctx, r),
          text: r.snippet.replace(/<\/?mark>/g, ""),
          kind: r.kind,
          objectKind: r.objectKind,
          boardIds: r.boardIds.map((b) => `board:${b}`),
          page: r.page,
        })),
      });
    },
  );

  server.registerTool(
    "fetch",
    {
      description:
        "Fetch the full content of one item by id: note:<id> (Craft note markdown with its links), object:<id> (local card/text/card/image/pdf/youtube), card:<id>, asset:<id> or pdf_page:<assetId>:<page> (PDF text), board:<id>. Long text is paged: the reply's textRange says if it was truncated and which offset to pass next.",
      inputSchema: {
        id: z.string().min(1),
        offset: z.number().int().min(0).optional().describe("Character offset into the item's text (default 0)"),
        maxChars: z.number().int().min(1000).max(FETCH_MAX_CHARS).optional().describe(`Characters of text to return (default ${FETCH_DEFAULT_CHARS}, max ${FETCH_MAX_CHARS})`),
      },
      annotations: ro,
    },
    async ({ id, offset, maxChars }) => {
      const item = await fetchItem(ctx, id);
      if (!item) return notFound(id);
      return text("text" in item ? pageText(item, offset ?? 0, maxChars ?? FETCH_DEFAULT_CHARS) : item);
    },
  );

  server.registerTool(
    "get_pdf_pages",
    { description: "Read extracted text of an uploaded PDF by page range, for page-level citations.", inputSchema: { assetId: z.string().min(1), from: z.number().int().min(1).optional(), to: z.number().int().min(1).optional() }, annotations: ro },
    async ({ assetId, from, to }) => {
      const aid = assetId.replace(/^asset:/, "");
      const asset = await ctx.env.DB.prepare("SELECT page_count, filename FROM assets WHERE id = ? AND kind = 'pdf'").bind(aid).first<{ page_count: number | null; filename: string }>();
      if (!asset) return notFound(assetId);
      const f = from ?? 1;
      const t = Math.min(to ?? f + 19, f + 49);
      const r = await ctx.env.DB.prepare("SELECT page, text FROM asset_pages WHERE asset_id = ? AND page BETWEEN ? AND ? ORDER BY page").bind(aid, f, t).all<{ page: number; text: string }>();
      const all = r.results ?? [];
      let total = 0;
      const pages: { page: number; text: string }[] = [];
      for (const p of all) {
        if (total + p.text.length > PAGES_TEXT_CHARS) break;
        total += p.text.length;
        pages.push(p);
      }
      const lastPage = pages.length ? pages[pages.length - 1].page : null;
      return text({ assetId: `asset:${aid}`, filename: asset.filename, pageCount: asset.page_count, from: f, to: t, lastPageIncluded: lastPage, truncated: pages.length < all.length, pages, url: `${ctx.origin}/api/assets/${aid}` });
    },
  );

  server.registerTool(
    "list_relationships",
    { description: "List arrows (user-drawn relationships with type, label and direction) and Craft links, for a board or for one item (note:<id> / object:<id> / card:<id>).", inputSchema: { boardId: z.string().optional(), itemId: z.string().optional() }, annotations: ro },
    async ({ boardId, itemId }) => {
      if (boardId) {
        const b = await getBoard(ctx, boardId.replace(/^board:/, ""));
        return b ? text({ arrows: b.arrows, craftLinks: b.craftLinks }) : notFound(boardId);
      }
      if (itemId) {
        const item = await fetchItem(ctx, itemId);
        if (!item || !("metadata" in item)) return notFound(itemId);
        const m = item.metadata as Record<string, unknown>;
        return text({ arrows: m.arrows ?? [], craftLinksOut: m.craftLinksOut ?? [], craftLinksIn: m.craftLinksIn ?? [] });
      }
      const r = await ctx.env.DB.prepare("SELECT * FROM arrows ORDER BY created_at DESC LIMIT 500").all<ArrowRow>();
      return text({ arrows: await describeArrows(ctx.env, (r.results ?? []).map(toArrow)) });
    },
  );

  return server;
}

/** Handle one MCP request statelessly: a fresh server and transport per call. */
export async function handleMcp(env: Bindings, request: Request): Promise<Response> {
  const origin = new URL(request.url).origin;
  const server = buildMcpServer({ env, origin });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
