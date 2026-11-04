import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../worker/index";
import type { Bindings } from "../worker/env";
import type { Board, BoardDetail, Card, Link, Note, NoteSummary, SyncResult, SyncStatus } from "../shared/types";

const E = env as unknown as Bindings;

let cookie = "";

async function req(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.auth !== false && cookie) headers.set("cookie", cookie);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.request(`https://craftcanvas.test${path}`, { ...init, headers }, E);
}

async function login(): Promise<void> {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ password: "test-password" }), auth: false });
  expect(res.status).toBe(200);
  const set = res.headers.get("set-cookie") ?? "";
  cookie = set.split(";")[0];
  expect(cookie.startsWith("cc_session=")).toBe(true);
  expect(set).toMatch(/HttpOnly/i);
  expect(set).toMatch(/SameSite=Lax/i);
  expect(set).toMatch(/Secure/i);
}

describe("auth gate", () => {
  it("serves the login page, not the app, to anonymous page requests", async () => {
    for (const p of ["/", "/boards/abc", "/assets/index.js"]) {
      const res = await req(p, { auth: false });
      expect(res.status).toBe(401);
      expect(res.headers.get("content-type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain('id="login"');
      expect(html).not.toContain('id="root"');
      expect(res.headers.get("x-robots-tag")).toContain("noindex");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("rejects anonymous API calls with 401 JSON", async () => {
    const res = await req("/api/notes", { auth: false });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized", message: "Sign in first." });
  });

  it("rejects a wrong password and a tampered cookie", async () => {
    const bad = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ password: "nope" }), auth: false });
    expect(bad.status).toBe(401);
    const forged = await app.request("https://craftcanvas.test/api/notes", { headers: { cookie: "cc_session=9999999999.abc.def" } }, E);
    expect(forged.status).toBe(401);
  });

  it("logs in with the right password and logs out", async () => {
    await login();
    const me = await req("/api/auth/me");
    expect(await me.json()).toEqual({ ok: true, mode: "fixture" });
    const out = await req("/api/auth/logout", { method: "POST" });
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });

  it("serves robots.txt that disallows everything", async () => {
    const res = await req("/robots.txt", { auth: false });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Disallow: /");
  });
});

describe("sync, notes and links (fixture mode)", () => {
  beforeAll(login);

  it("reports an empty cache before sync", async () => {
    const s = (await (await req("/api/sync/status")).json()) as SyncStatus;
    expect(s.mode).toBe("fixture");
    expect(s.noteCount).toBe(0);
    expect(s.running).toBe(false);
  });

  it("imports the fixtures in batches with a cursor and resolves links", async () => {
    let cursor: string | null = null;
    let steps = 0;
    let imported = 0;
    for (;;) {
      const r = (await (await req("/api/sync", { method: "POST", body: JSON.stringify({ cursor }) })).json()) as SyncResult;
      steps += 1;
      imported += r.imported;
      expect(r.total).toBe(12);
      if (r.done) break;
      expect(r.cursor).not.toBeNull();
      cursor = r.cursor;
      if (steps > 10) throw new Error("sync did not finish");
    }
    expect(steps).toBe(2);
    expect(imported).toBe(12);
    const s = (await (await req("/api/sync/status")).json()) as SyncStatus;
    expect(s.noteCount).toBe(12);
    expect(s.lastSyncAt).not.toBeNull();
    expect(s.linkCount).toBeGreaterThan(10);
  });

  it("rejects a cursor with no sync in progress", async () => {
    const r = await req("/api/sync", { method: "POST", body: JSON.stringify({ cursor: "3" }) });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe("bad_cursor");
  });

  it("lists, searches and filters notes", async () => {
    const all = (await (await req("/api/notes")).json()) as { items: NoteSummary[]; total: number };
    expect(all.total).toBe(12);
    expect(all.items.length).toBe(12);
    const cc = all.items.find((n) => n.id === "n-craftcanvas")!;
    expect(cc.title).toBe("CraftCanvas");
    expect(cc.linkCount).toBe(5);
    expect(cc.backlinkCount).toBeGreaterThanOrEqual(4);
    expect(cc.deepLinkApp).toBe("craftdocs://open?spaceId=fixture-space&documentId=n-craftcanvas");
    expect(cc.deepLinkWeb).toBe("https://docs.craft.do/editor/d/fixture-space/n-craftcanvas");
    expect(cc.preview).not.toContain("<page>");
    expect(cc.preview).not.toContain("block://");

    const q = (await (await req("/api/notes?q=zettel")).json()) as { items: NoteSummary[]; total: number };
    expect(q.items.map((n) => n.id)).toContain("n-zettelkasten"); // title and preview both match
    expect(q.total).toBe(4);
    const byTitle = (await (await req("/api/notes?q=loose%20thought")).json()) as { items: NoteSummary[]; total: number };
    expect(byTitle.items.map((n) => n.id)).toEqual(["n-orphan"]);
    const noHit = (await (await req("/api/notes?q=%25")).json()) as { items: NoteSummary[]; total: number };
    expect(noHit.total).toBe(0); // LIKE wildcards are escaped

    const f = (await (await req("/api/notes?folder=f-reading")).json()) as { items: NoteSummary[]; total: number };
    expect(f.total).toBe(3);

    const paged = (await (await req("/api/notes?limit=5&offset=10")).json()) as { items: NoteSummary[]; total: number };
    expect(paged.items.length).toBe(2);
    expect(paged.total).toBe(12);
  });

  it("returns a full note with outgoing, incoming links and markdown", async () => {
    const n = (await (await req("/api/notes/n-craftcanvas")).json()) as Note;
    expect(n.markdown.startsWith("# CraftCanvas")).toBe(true);
    expect(n.outgoing.map((l) => l.targetNoteId).sort()).toEqual(["n-canvas-perf", "n-cloudflare", "n-craft-api", "n-heptabase", "n-suggested-relations"]);
    expect(n.incoming.map((l) => l.sourceNoteId)).toContain("n-rate-limits");
    expect(n.boards).toEqual([]);
    const missing = await req("/api/notes/does-not-exist");
    expect(missing.status).toBe(404);
  });

  it("keeps out-of-scope links on the note but out of the global link list", async () => {
    const api = (await (await req("/api/notes/n-craft-api")).json()) as Note;
    const oos = api.outgoing.filter((l) => l.outOfScope);
    expect(oos.length).toBe(1);
    expect(oos[0].targetNoteId).toBeNull();
    const links = (await (await req("/api/links")).json()) as { items: Link[] };
    expect(links.items.every((l) => l.targetNoteId && !l.outOfScope)).toBe(true);
    expect(links.items.some((l) => l.sourceNoteId === "n-weekly-review" && l.targetNoteId === "n-reading-list")).toBe(true);
  });

  it("lists folders with counts", async () => {
    const f = (await (await req("/api/folders")).json()) as { items: { id: string; name: string; noteCount: number }[] };
    expect(f.items).toEqual([
      { id: "f-ideas", name: "Ideas", noteCount: 3 },
      { id: "f-projects", name: "Projects", noteCount: 4 },
      { id: "f-reading", name: "Reading", noteCount: 3 },
    ]);
  });

  it("re-syncing is idempotent", async () => {
    let cursor: string | null = null;
    for (;;) {
      const r = (await (await req("/api/sync", { method: "POST", body: JSON.stringify({ cursor }) })).json()) as SyncResult;
      if (r.done) break;
      cursor = r.cursor;
    }
    const s = (await (await req("/api/sync/status")).json()) as SyncStatus;
    expect(s.noteCount).toBe(12);
    const links = (await (await req("/api/links")).json()) as { items: Link[] };
    const keys = links.items.map((l) => `${l.sourceNoteId}>${l.targetBlockId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("boards, cards, sections, connections", () => {
  let board: Board;
  let card: Card;

  beforeAll(login);

  it("creates and lists boards", async () => {
    const bad = await req("/api/boards", { method: "POST", body: JSON.stringify({}) });
    expect(bad.status).toBe(400);
    const res = await req("/api/boards", { method: "POST", body: JSON.stringify({ name: "  Research  " }) });
    expect(res.status).toBe(201);
    board = (await res.json()) as Board;
    expect(board.name).toBe("Research");
    expect(board.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    const list = (await (await req("/api/boards")).json()) as { items: Board[] };
    expect(list.items.map((b) => b.id)).toContain(board.id);
  });

  it("adds a card for a note, refuses duplicates and unknown notes", async () => {
    const res = await req(`/api/boards/${board.id}/cards`, { method: "POST", body: JSON.stringify({ noteId: "n-heptabase", x: 10, y: 20 }) });
    expect(res.status).toBe(201);
    card = (await res.json()) as Card;
    expect(card).toMatchObject({ noteId: "n-heptabase", x: 10, y: 20, w: 260, h: 160, folded: false, sectionId: null });
    const dup = await req(`/api/boards/${board.id}/cards`, { method: "POST", body: JSON.stringify({ noteId: "n-heptabase", x: 0, y: 0 }) });
    expect(dup.status).toBe(409);
    const unknown = await req(`/api/boards/${board.id}/cards`, { method: "POST", body: JSON.stringify({ noteId: "nope", x: 0, y: 0 }) });
    expect(unknown.status).toBe(404);
    const second = await req(`/api/boards/${board.id}/cards`, { method: "POST", body: JSON.stringify({ noteId: "n-canvas-perf", x: 400, y: 20 }) });
    expect(second.status).toBe(201);
  });

  it("bulk-updates card positions and fold state", async () => {
    const res = await req(`/api/boards/${board.id}/cards`, {
      method: "PUT",
      body: JSON.stringify({ cards: [{ id: card.id, x: 111, y: 222, folded: true }, { id: "missing", x: 1 }] }),
    });
    expect(await res.json()).toEqual({ updated: 1 });
  });

  it("creates a section, assigns a card, deletes the section and keeps the card", async () => {
    const s = await req(`/api/boards/${board.id}/sections`, { method: "POST", body: JSON.stringify({ name: "Theory", x: 0, y: 0, w: 800, h: 600, color: "#eee" }) });
    expect(s.status).toBe(201);
    const section = (await s.json()) as { id: string };
    const assign = await req(`/api/boards/${board.id}/cards`, { method: "PUT", body: JSON.stringify({ cards: [{ id: card.id, sectionId: section.id }] }) });
    expect(await assign.json()).toEqual({ updated: 1 });
    const renamed = await req(`/api/boards/${board.id}/sections/${section.id}`, { method: "PATCH", body: JSON.stringify({ name: "Theory 2" }) });
    expect(((await renamed.json()) as { name: string }).name).toBe("Theory 2");
    const del = await req(`/api/boards/${board.id}/sections/${section.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    const detail = (await (await req(`/api/boards/${board.id}`)).json()) as BoardDetail;
    expect(detail.sections).toEqual([]);
    expect(detail.cards.find((c) => c.id === card.id)?.sectionId).toBeNull();
  });

  it("adds and removes a board-only connection", async () => {
    const c1 = await req(`/api/boards/${board.id}/connections`, { method: "POST", body: JSON.stringify({ sourceNoteId: "n-heptabase", targetNoteId: "n-canvas-perf" }) });
    expect(c1.status).toBe(201);
    const conn = (await c1.json()) as { id: string; kind: string };
    expect(conn.kind).toBe("manual");
    const same = await req(`/api/boards/${board.id}/connections`, { method: "POST", body: JSON.stringify({ sourceNoteId: "a", targetNoteId: "a" }) });
    expect(same.status).toBe(400);
    const del = await req(`/api/boards/${board.id}/connections/${conn.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
  });

  it("returns board detail with cards, notes and the note's board list", async () => {
    const detail = (await (await req(`/api/boards/${board.id}`)).json()) as BoardDetail;
    expect(detail.cardCount).toBe(2);
    expect(detail.cards.length).toBe(2);
    expect(detail.notes.map((n) => n.id).sort()).toEqual(["n-canvas-perf", "n-heptabase"]);
    expect(detail.cards.find((c) => c.id === card.id)).toMatchObject({ x: 111, y: 222, folded: true });
    const onBoards = (await (await req("/api/notes/n-heptabase/boards")).json()) as { items: { boardId: string }[] };
    expect(onBoards.items.map((b) => b.boardId)).toEqual([board.id]);
  });

  it("updates the viewport and name, then deletes the board and its cards", async () => {
    const p = await req(`/api/boards/${board.id}`, { method: "PATCH", body: JSON.stringify({ name: "Research v2", viewport: { x: 5, y: 6, zoom: 0.5 } }) });
    const b = (await p.json()) as Board;
    expect(b.name).toBe("Research v2");
    expect(b.viewport).toEqual({ x: 5, y: 6, zoom: 0.5 });
    const del = await req(`/api/boards/${board.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect((await req(`/api/boards/${board.id}`)).status).toBe(404);
    const onBoards = (await (await req("/api/notes/n-heptabase/boards")).json()) as { items: unknown[] };
    expect(onBoards.items).toEqual([]);
  });
});
