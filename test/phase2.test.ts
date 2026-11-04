import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../worker/index";
import type { Bindings } from "../worker/env";
import { parseYouTubeId } from "../worker/youtube";
import { buildMatch, normalizeText } from "../worker/search";
import type { Arrow, Asset, Board, BoardDetailV2, CanvasObject, Card, SearchResult, SyncResult } from "../shared/types";

const E = env as unknown as Bindings;
let cookie = "";

async function req(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.auth !== false && cookie) headers.set("cookie", cookie);
  if (init.body && typeof init.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.request(`https://craftcanvas.test${path}`, { ...init, headers }, E);
}
const json = async <T>(p: Promise<Response>): Promise<T> => (await p).json() as Promise<T>;

async function login() {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ password: "test-password" }), auth: false });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function syncAll() {
  let cursor: string | null = null;
  for (;;) {
    const r: SyncResult = await json<SyncResult>(req("/api/sync", { method: "POST", body: JSON.stringify({ cursor }) }));
    if (r.done) break;
    cursor = r.cursor;
  }
}

describe("helpers", () => {
  it("parses YouTube urls", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1s")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYouTubeId("not a url")).toBeNull();
  });
  it("folds diacritics and builds prefix matches", () => {
    expect(normalizeText("Lịch sử Việt Nam Đình")).toBe("lich su viet nam dinh");
    expect(buildMatch('việt "nam"')).toBe('"viet"* "nam"*');
    expect(buildMatch("x".repeat(200))).toBe(`"${"x".repeat(64)}"*`);
    expect(buildMatch("   ")).toBeNull();
  });
});

describe("phase 2 API", () => {
  let board: Board;
  let card: Card;
  let textObj: CanvasObject;
  let cardObj: CanvasObject;
  let arrow: Arrow;
  let image: Asset;
  let pdf: Asset;

  beforeAll(async () => {
    await login();
    await syncAll();
    board = await json<Board>(req("/api/boards", { method: "POST", body: JSON.stringify({ name: "Phase 2" }) }));
    card = await json<Card>(req(`/api/boards/${board.id}/cards`, { method: "POST", body: JSON.stringify({ noteId: "n-heptabase", x: 0, y: 0 }) }));
  });

  it("creates text and card objects and lists them in board detail", async () => {
    const t = await req(`/api/boards/${board.id}/objects`, { method: "POST", body: JSON.stringify({ kind: "text", x: 10, y: 20, text: "Free text anywhere" }) });
    expect(t.status).toBe(201);
    textObj = (await t.json()) as CanvasObject;
    expect(textObj).toMatchObject({ kind: "text", x: 10, y: 20, w: 240, h: 80, text: "Free text anywhere", assetId: null });
    const c = await req(`/api/boards/${board.id}/objects`, { method: "POST", body: JSON.stringify({ kind: "card", x: 300, y: 20, title: "Lịch sử Việt Nam", text: "Ghi chú về Ngô Đình Nhu" }) });
    cardObj = (await c.json()) as CanvasObject;
    expect(cardObj.kind).toBe("card");
    const bad = await req(`/api/boards/${board.id}/objects`, { method: "POST", body: JSON.stringify({ kind: "sticker", x: 0, y: 0 }) });
    expect(bad.status).toBe(400);
    const detail = await json<BoardDetailV2>(req(`/api/boards/${board.id}`));
    expect(detail.objects.map((o) => o.id).sort()).toEqual([textObj.id, cardObj.id].sort());
    expect(detail.arrows).toEqual([]);
  });

  it("edits, bulk-moves and searches objects with diacritics folded", async () => {
    const p = await req(`/api/boards/${board.id}/objects/${cardObj.id}`, { method: "PATCH", body: JSON.stringify({ text: "Ghi chú mới về Ngô Đình Nhu" }) });
    expect(((await p.json()) as CanvasObject).text).toBe("Ghi chú mới về Ngô Đình Nhu");
    const mv = await json<{ updated: number }>(req(`/api/boards/${board.id}/objects`, { method: "PUT", body: JSON.stringify({ objects: [{ id: textObj.id, x: 99, y: 98 }, { id: "nope", x: 1 }] }) }));
    expect(mv.updated).toBe(1);
    const found = await json<{ results: SearchResult[] }>(req("/api/search?q=viet%20nam"));
    const hit = found.results.find((r) => r.id === `object:${cardObj.id}`);
    expect(hit).toBeDefined();
    expect(hit!.kind).toBe("object");
    expect(hit!.objectKind).toBe("card");
    expect(hit!.boardIds).toEqual([board.id]);
    const notes = await json<{ results: SearchResult[] }>(req("/api/search?q=zettel&kinds=note"));
    expect(notes.results.some((r) => r.id === "note:n-zettelkasten")).toBe(true);
    expect(notes.results.every((r) => r.kind === "note")).toBe(true);
    const edited = await json<{ results: SearchResult[] }>(req("/api/search?q=moi"));
    expect(edited.results.some((r) => r.id === `object:${cardObj.id}`)).toBe(true);
  });

  it("draws, re-routes and deletes arrows between a card and an object", async () => {
    const a = await req(`/api/boards/${board.id}/arrows`, {
      method: "POST",
      body: JSON.stringify({ source: { kind: "card", id: card.id }, target: { kind: "object", id: cardObj.id }, label: "explains", sourceHandle: "right", targetHandle: "left" }),
    });
    expect(a.status).toBe(201);
    arrow = (await a.json()) as Arrow;
    expect(arrow).toMatchObject({ type: "parent_child", label: "explains", source: { kind: "card", id: card.id }, target: { kind: "object", id: cardObj.id } });
    const offBoard = await req(`/api/boards/${board.id}/arrows`, { method: "POST", body: JSON.stringify({ source: { kind: "card", id: card.id }, target: { kind: "object", id: "missing" } }) });
    expect(offBoard.status).toBe(400);
    const re = await req(`/api/boards/${board.id}/arrows/${arrow.id}`, { method: "PATCH", body: JSON.stringify({ target: { kind: "object", id: textObj.id }, type: "related", label: null }) });
    const rerouted = (await re.json()) as Arrow;
    expect(rerouted).toMatchObject({ type: "related", label: null, target: { kind: "object", id: textObj.id } });
    const detail = await json<BoardDetailV2>(req(`/api/boards/${board.id}`));
    expect(detail.arrows.length).toBe(1);
    expect(detail.cards.length).toBe(1);
    expect(detail.objects.length).toBe(2);
  });

  it("removes arrows when an endpoint object is deleted, and drops it from search", async () => {
    const del = await req(`/api/boards/${board.id}/objects/${textObj.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    const detail = await json<BoardDetailV2>(req(`/api/boards/${board.id}`));
    expect(detail.arrows).toEqual([]);
    expect(detail.objects.map((o) => o.id)).toEqual([cardObj.id]);
    const found = await json<{ results: SearchResult[] }>(req("/api/search?q=anywhere"));
    expect(found.results.some((r) => r.id === `object:${textObj.id}`)).toBe(false);
  });

  it("uploads an image, serves it back, and refuses wrong types and oversized files", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const form = new FormData();
    form.set("file", new File([png], "pic.png", { type: "image/png" }));
    form.set("width", "640");
    form.set("height", "480");
    const up = await req("/api/uploads", { method: "POST", body: form });
    expect(up.status).toBe(201);
    image = (await up.json()) as Asset;
    expect(image).toMatchObject({ kind: "image", filename: "pic.png", contentType: "image/png", size: png.length, width: 640, height: 480, textStatus: "none" });
    const get = await req(image.url);
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(png);
    expect((await req(image.url, { auth: false })).status).toBe(401);

    const txt = new FormData();
    txt.set("file", new File(["hello"], "x.txt", { type: "text/plain" }));
    expect((await req("/api/uploads", { method: "POST", body: txt })).status).toBe(415);

    const big = new FormData();
    big.set("file", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }));
    const tooBig = await req("/api/uploads", { method: "POST", body: big });
    expect(tooBig.status).toBe(413);
    expect(((await tooBig.json()) as { error: string }).error).toBe("too_large");

    const obj = await req(`/api/boards/${board.id}/objects`, { method: "POST", body: JSON.stringify({ kind: "image", x: 0, y: 500, assetId: image.id, text: "A caption" }) });
    expect(obj.status).toBe(201);
    const imgObj = (await obj.json()) as CanvasObject;
    expect(imgObj).toMatchObject({ kind: "image", title: "pic.png", w: 480, h: 360, meta: { width: 640, height: 480 } });
    expect((await req(`/api/assets/${image.id}`, { method: "DELETE" })).status).toBe(409);
  });

  it("stores PDF page text, makes pages searchable with page numbers, and serves ranges", async () => {
    const form = new FormData();
    form.set("file", new File(["%PDF-1.4 fake"], "paper.pdf", { type: "application/pdf" }));
    pdf = await json<Asset>(req("/api/uploads", { method: "POST", body: form }));
    expect(pdf).toMatchObject({ kind: "pdf", textStatus: "pending", pageCount: null });
    const pdfObj = await json<CanvasObject>(req(`/api/boards/${board.id}/objects`, { method: "POST", body: JSON.stringify({ kind: "pdf", x: 0, y: 900, assetId: pdf.id, title: "Sack of potatoes paper" }) }));
    expect(pdfObj.w).toBe(320);
    const put = await req(`/api/assets/${pdf.id}/text`, {
      method: "PUT",
      body: JSON.stringify({ pageCount: 3, pages: [{ page: 1, text: "Introduction to peasant economies" }, { page: 2, text: "Marx on the sack of potatoes problem" }, { page: 3, text: "" }] }),
    });
    expect(await put.json()).toEqual({ indexed: 2, pageCount: 3 });
    const found = await json<{ results: SearchResult[] }>(req("/api/search?q=potatoes"));
    const hit = found.results.find((r) => r.kind === "pdf_page");
    expect(hit).toMatchObject({ id: `pdf_page:${pdf.id}:2`, page: 2, assetId: pdf.id, boardIds: [board.id] });
    expect(hit!.title).toContain("(p. 2)");
    expect(hit!.snippet).toContain("<mark>");
    const range = await json<{ pages: { page: number; text: string }[]; pageCount: number }>(req(`/api/assets/${pdf.id}/text?from=2&to=3`));
    expect(range.pageCount).toBe(3);
    expect(range.pages.map((p) => p.page)).toEqual([2, 3]);
    const meta = await json<Asset>(req(`/api/assets/${pdf.id}/meta`));
    expect(meta.textStatus).toBe("done");
    const detail = await json<BoardDetailV2>(req(`/api/boards/${board.id}`));
    expect(detail.objects.find((o) => o.id === pdfObj.id)?.meta).toEqual({ pageCount: 3 });
  });

  it("deleting the board cascades objects, arrows and their search entries", async () => {
    const other = await json<Board>(req("/api/boards", { method: "POST", body: JSON.stringify({ name: "Throwaway" }) }));
    const o = await json<CanvasObject>(req(`/api/boards/${other.id}/objects`, { method: "POST", body: JSON.stringify({ kind: "text", x: 0, y: 0, text: "ephemeral walrus" }) }));
    expect((await json<{ results: SearchResult[] }>(req("/api/search?q=walrus"))).results.length).toBe(1);
    expect((await req(`/api/boards/${other.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await json<{ results: SearchResult[] }>(req("/api/search?q=walrus"))).results.length).toBe(0);
    expect((await req(`/api/boards/${other.id}/objects/${o.id}`, { method: "PATCH", body: JSON.stringify({ text: "x" }) })).status).toBe(404);
  });
});

describe("MCP endpoint", () => {
  const H = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const rpc = (id: number, method: string, params?: unknown) => JSON.stringify({ jsonrpc: "2.0", id, method, params });

  beforeAll(async () => {
    // Self-contained: make sure the cache and a "Phase 2" board with one card and three objects exist.
    await login();
    await syncAll();
    const boards = await json<{ items: Board[] }>(req("/api/boards"));
    if (!boards.items.some((b) => b.name === "Phase 2")) {
      const b = await json<Board>(req("/api/boards", { method: "POST", body: JSON.stringify({ name: "Phase 2" }) }));
      await req(`/api/boards/${b.id}/cards`, { method: "POST", body: JSON.stringify({ noteId: "n-heptabase", x: 0, y: 0 }) });
      await req(`/api/boards/${b.id}/objects`, { method: "POST", body: JSON.stringify({ kind: "card", x: 0, y: 0, title: "Card" }) });
      const form = new FormData();
      form.set("file", new File([new Uint8Array([1, 2, 3])], "p.png", { type: "image/png" }));
      const img = await json<Asset>(req("/api/uploads", { method: "POST", body: form }));
      await req(`/api/boards/${b.id}/objects`, { method: "POST", body: JSON.stringify({ kind: "image", x: 0, y: 0, assetId: img.id }) });
      const pf = new FormData();
      pf.set("file", new File(["%PDF-1.4"], "p.pdf", { type: "application/pdf" }));
      const pdfA = await json<Asset>(req("/api/uploads", { method: "POST", body: pf }));
      await req(`/api/boards/${b.id}/objects`, { method: "POST", body: JSON.stringify({ kind: "pdf", x: 0, y: 0, assetId: pdfA.id }) });
    }
  });

  async function call(path: string, body: string, extra: Record<string, string> = {}) {
    return app.request(`https://craftcanvas.test${path}`, { method: "POST", headers: { ...H, ...extra }, body }, E);
  }

  it("rejects missing or wrong tokens and non-POST methods", async () => {
    const none = await call("/mcp", rpc(1, "tools/list"));
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe("Bearer");
    expect((await call("/mcp", rpc(1, "tools/list"), { authorization: "Bearer wrong-token-value" })).status).toBe(401);
    expect((await call("/mcp/wrong-token-value", rpc(1, "tools/list"))).status).toBe(401);
    const get = await app.request("https://craftcanvas.test/mcp", { headers: { authorization: "Bearer test-mcp-token-0123456789" } }, E);
    expect(get.status).toBe(405);
  });

  it("initializes and lists only read-only tools, via bearer header and via path token", async () => {
    const init = await call("/mcp", rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } }), { authorization: "Bearer test-mcp-token-0123456789" });
    expect(init.status).toBe(200);
    const initBody = (await init.json()) as { result: { serverInfo: { name: string } } };
    expect(initBody.result.serverInfo.name).toBe("craftcanvas");
    const list = await call("/mcp/test-mcp-token-0123456789", rpc(2, "tools/list"));
    expect(list.status).toBe(200);
    const tools = ((await list.json()) as { result: { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] } }).result.tools;
    expect(tools.map((t) => t.name).sort()).toEqual(["fetch", "get_board", "get_pdf_pages", "list_boards", "list_relationships", "search"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("searches and fetches a note with ChatGPT-compatible shapes", async () => {
    const s = await call("/mcp", rpc(3, "tools/call", { name: "search", arguments: { query: "heptabase model", limit: 5 } }), { authorization: "Bearer test-mcp-token-0123456789" });
    const sb = (await s.json()) as { result: { structuredContent: { results: { id: string; title: string; url: string; text: string }[] }; content: { type: string; text: string }[] } };
    const first = sb.result.structuredContent.results.find((r) => r.id === "note:n-heptabase");
    expect(first).toBeDefined();
    expect(first!.url).toContain("docs.craft.do");
    expect(sb.result.content[0].type).toBe("text");
    expect(JSON.parse(sb.result.content[0].text).results.length).toBeGreaterThan(0);

    const f = await call("/mcp", rpc(4, "tools/call", { name: "fetch", arguments: { id: "note:n-heptabase" } }), { authorization: "Bearer test-mcp-token-0123456789" });
    const fb = (await f.json()) as { result: { structuredContent: { id: string; title: string; text: string; url: string; metadata: { craftLinksOut: unknown[]; boards: unknown[] } } } };
    expect(fb.result.structuredContent).toMatchObject({ id: "note:n-heptabase", title: "Heptabase model" });
    expect(fb.result.structuredContent.text).toContain("Cards live in one library");
    expect(fb.result.structuredContent.metadata.craftLinksOut.length).toBe(2);

    const boards = await call("/mcp", rpc(5, "tools/call", { name: "list_boards", arguments: {} }), { authorization: "Bearer test-mcp-token-0123456789" });
    const bb = (await boards.json()) as { result: { structuredContent: { boards: { id: string; name: string; cardCount: number; objectCount: number }[] } } };
    const p2 = bb.result.structuredContent.boards.find((b) => b.name === "Phase 2");
    expect(p2).toMatchObject({ cardCount: 1, objectCount: 3 });
    const gb = await call("/mcp", rpc(6, "tools/call", { name: "get_board", arguments: { boardId: p2!.id } }), { authorization: "Bearer test-mcp-token-0123456789" });
    const gbb = (await gb.json()) as { result: { structuredContent: { items: { id: string; kind: string }[]; arrows: unknown[] } } };
    expect(gbb.result.structuredContent.items.map((i) => i.kind).sort()).toEqual(["card", "image", "note", "pdf"]);
  });
});

describe("review fixes", () => {
  beforeAll(login);
  it("search matches a đ-only difference and marks the snippet from the best column", async () => {
    const b = await json<Board>(req("/api/boards", { method: "POST", body: JSON.stringify({ name: "Đ board" }) }));
    await req(`/api/boards/${b.id}/objects`, { method: "POST", body: JSON.stringify({ kind: "text", x: 0, y: 0, text: "Dinh Gia Long với Ngô Đình Nhu" }) });
    const r = await json<{ results: SearchResult[] }>(req("/api/search?q=dinh"));
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results[0].snippet).toContain("<mark>");
    await req(`/api/boards/${b.id}`, { method: "DELETE" });
  });
  it("stops an oversized body before buffering it, and rejects PATCH to an unknown section", async () => {
    const huge = new Uint8Array(27 * 1024 * 1024);
    const res = await app.request("https://craftcanvas.test/api/uploads", { method: "POST", headers: { cookie, "content-type": "multipart/form-data; boundary=x" }, body: huge }, E);
    expect(res.status).toBe(413);
    const b = await json<Board>(req("/api/boards", { method: "POST", body: JSON.stringify({ name: "Sections" }) }));
    const o = await json<CanvasObject>(req(`/api/boards/${b.id}/objects`, { method: "POST", body: JSON.stringify({ kind: "text", x: 0, y: 0, text: "t" }) }));
    expect((await req(`/api/boards/${b.id}/objects/${o.id}`, { method: "PATCH", body: JSON.stringify({ sectionId: "nope" }) })).status).toBe(400);
    await req(`/api/boards/${b.id}`, { method: "DELETE" });
  });
});

describe("MCP fetch paging", () => {
  const H = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer test-mcp-token-0123456789" };
  it("pages long text with offset and reports the range", async () => {
    await login();
    await syncAll();
    const b = await json<Board>(req("/api/boards", { method: "POST", body: JSON.stringify({ name: "Paging" }) }));
    const long = "word ".repeat(6000); // 30 000 chars
    const o = await json<CanvasObject>(req(`/api/boards/${b.id}/objects`, { method: "POST", body: JSON.stringify({ kind: "card", x: 0, y: 0, title: "Long", text: long }) }));
    const call = (args: Record<string, unknown>) =>
      app.request("https://craftcanvas.test/mcp", { method: "POST", headers: H, body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "fetch", arguments: args } }) }, E);
    const first = ((await (await call({ id: `object:${o.id}` })).json()) as { result: { structuredContent: { text: string; textRange: { truncated: boolean; nextOffset: number | null; totalChars: number } } } }).result.structuredContent;
    expect(first.text.length).toBe(20_000);
    expect(first.textRange).toMatchObject({ truncated: true, nextOffset: 20_000, totalChars: 30_000 });
    const second = ((await (await call({ id: `object:${o.id}`, offset: 20_000 })).json()) as { result: { structuredContent: { text: string; textRange: { truncated: boolean; nextOffset: number | null } } } }).result.structuredContent;
    expect(second.text.length).toBe(10_000);
    expect(second.textRange).toMatchObject({ truncated: false, nextOffset: null });
    await req(`/api/boards/${b.id}`, { method: "DELETE" });
  });
});
