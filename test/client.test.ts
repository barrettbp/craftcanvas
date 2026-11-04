import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CraftClient } from "../worker/craft/client";
import type { Bindings } from "../worker/env";
import type { NoteSource, Enumeration } from "../worker/craft/source";
import type { DocRef, RawDocument } from "../worker/craft/parse";
import { CraftApiError } from "../worker/craft/client";
import { runSyncStep } from "../worker/sync";

const E = env as unknown as Bindings;

function stubFetch(handler: (url: URL, init: RequestInit) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => handler(new URL(String(input)), init ?? {})) as typeof fetch;
}

describe("CraftClient", () => {
  it("falls back to text/markdown when the JSON call returns a non-JSON body", async () => {
    const calls: string[] = [];
    const client = new CraftClient({
      connectionUrl: "https://connect.example/links/SECRET/api/v1",
      minGapMs: 0,
      fetchImpl: stubFetch((url, init) => {
        const accept = new Headers(init.headers).get("accept");
        calls.push(`${url.pathname.split("/").pop()}:${accept}`);
        return new Response("<page><pageTitle>T</pageTitle><content>\nHi [x](block://z)\n</content></page>", { status: 200, headers: { "content-type": "text/markdown" } });
      }),
    });
    const doc = await client.getDocument({ id: "d1", title: "T", folderId: null, folderName: null });
    expect(calls).toEqual(["blocks:application/json", "blocks:text/markdown"]);
    expect(doc.markdown).toContain("block://z");
  });

  it("does not retry a 404 and throws a CraftApiError without the URL", async () => {
    let n = 0;
    const client = new CraftClient({ connectionUrl: "https://connect.example/links/SECRET/api/v1", minGapMs: 0, fetchImpl: stubFetch(() => (n++, new Response("nope", { status: 404 }))) });
    await expect(client.listFolders()).rejects.toMatchObject({ status: 404, name: "CraftApiError" });
    expect(n).toBe(1);
    try {
      await client.listFolders();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("SECRET");
    }
  });

  it("retries a 429 honouring a capped Retry-After and sends the bearer token", async () => {
    let n = 0;
    let auth: string | null = null;
    const client = new CraftClient({
      connectionUrl: "https://connect.example/links/SECRET/api/v1",
      token: "pdk_test",
      minGapMs: 0,
      fetchImpl: stubFetch((_url, init) => {
        auth = new Headers(init.headers).get("authorization");
        n += 1;
        return n === 1 ? new Response("slow down", { status: 429, headers: { "retry-after": "0" } }) : new Response(JSON.stringify({ items: [{ id: "f1", name: "F" }] }), { status: 200 });
      }),
    });
    const folders = await client.listFolders();
    expect(n).toBe(2);
    expect(auth).toBe("Bearer pdk_test");
    expect(folders).toEqual([{ id: "f1", name: "F", parentId: null }]);
  });
});

describe("runSyncStep with a flaky source", () => {
  const docs: DocRef[] = [
    { id: "a", title: "A", folderId: null, folderName: null },
    { id: "b", title: "B", folderId: null, folderName: null },
    { id: "c", title: "C", folderId: null, folderName: null },
  ];
  const raw = (id: string, body: string): RawDocument => ({ id, title: id.toUpperCase(), folderId: null, folderName: null, createdAt: null, modifiedAt: null, markdown: body, blockIds: [id, `${id}-sub`], deepLinkApp: null });

  const source: NoteSource = {
    mode: "craft",
    async enumerate(): Promise<Enumeration> {
      return { spaceId: "S", docs, meta: {}, partial: true };
    },
    async fetchDocument(ref) {
      if (ref.id === "b") throw new CraftApiError(404, "/blocks", "gone");
      return raw(ref.id, ref.id === "a" ? "see [c sub](block://c-sub) and [b](block://b)" : "leaf");
    },
  };

  it("skips 403/404/410 documents, resolves sub-block links, and keeps unseen notes when enumeration was partial", async () => {
    const db = E.DB;
    await db.prepare("INSERT OR REPLACE INTO notes (id, title, synced_at, deleted) VALUES ('old', 'Old', '2026-01-01', 0)").run();
    const r = await runSyncStep(E, source, null);
    expect(r.done).toBe(true);
    expect(r.imported).toBe(2);
    expect(r.skipped).toBe(1);
    expect(r.partial).toBe(true);
    const link = await db.prepare("SELECT target_note_id FROM links WHERE source_note_id = 'a' AND target_block_id = 'c-sub'").first<{ target_note_id: string }>();
    expect(link?.target_note_id).toBe("c");
    const old = await db.prepare("SELECT deleted FROM notes WHERE id = 'old'").first<{ deleted: number }>();
    expect(old?.deleted).toBe(0);
    await db.prepare("DELETE FROM notes WHERE id IN ('a','b','c','old')").run();
  });
});

describe("CraftClient without an injected fetch", () => {
  it("invokes the global fetch correctly (no Illegal invocation)", async () => {
    const client = new CraftClient({ connectionUrl: "https://invalid.localhost.test/api/v1", minGapMs: 0, maxRetries: 0 });
    let message = "";
    try {
      await client.listFolders();
    } catch (e) {
      message = String((e as Error).message);
    }
    expect(message).not.toContain("Illegal invocation");
  });
});
