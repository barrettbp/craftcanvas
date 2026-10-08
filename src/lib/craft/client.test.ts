import { afterEach, describe, expect, it, vi } from "vitest";

import { backoffDelay, createCraftClient, parseRetryAfter, redactKey, type CraftLogEntry } from "./client";
import {
  CraftNetworkError,
  CraftNotFoundError,
  CraftRateLimitedError,
  CraftRequestError,
  CraftServerError,
  CraftTimeoutError,
  CraftUnauthorizedError,
} from "./errors";

const KEY = "pdk_super_secret_key_123";
const BASE = "https://connect.craft.do/links/abc/api/v1/";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function textResponse(body: string, status = 200, contentType = "text/markdown"): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

type Harness = ReturnType<typeof harness>;

function harness(responses: Array<Response | Error | (() => Promise<Response>)>, opts: { maxRetries?: number; timeoutMs?: number } = {}) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const sleeps: number[] = [];
  const logs: CraftLogEntry[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error("no more mocked responses");
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next();
    return next;
  });
  const client = createCraftClient({
    baseUrl: BASE,
    apiKey: KEY,
    fetch: fetchMock as unknown as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    logger: (entry) => logs.push(entry),
    backoffBaseMs: 100,
    ...opts,
  });
  return { client, calls, sleeps, logs, fetchMock };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createCraftClient", () => {
  it("sends the bearer key and accept header and strips the trailing slash", async () => {
    const h = harness([jsonResponse({ folders: [] })]);
    await h.client.listFolders();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe("https://connect.craft.do/links/abc/api/v1/folders");
    const headers = h.calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers.Accept).toBe("application/json");
    expect(h.calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("normalises folders with paths derived from parents", async () => {
    const h = harness([
      jsonResponse({
        folders: [
          { id: "a", name: "Projects" },
          { id: "b", name: "Research", parentId: "a" },
          { id: "c", title: "Deep", parentFolderId: "b" },
        ],
      }),
    ]);
    const folders = await h.client.listFolders();
    expect(folders).toEqual([
      { id: "a", name: "Projects", parentId: undefined, path: "Projects" },
      { id: "b", name: "Research", parentId: "a", path: "Projects/Research" },
      { id: "c", name: "Deep", parentId: "b", path: "Projects/Research/Deep" },
    ]);
  });

  it("lists documents for a location and fills folder paths from context", async () => {
    const h = harness([
      jsonResponse({
        documents: [
          { id: "d1", title: "Doc one", updatedAt: "2026-01-02T03:04:05Z", url: "https://craft.do/s/x" },
          { documentId: "d2", name: "Doc two", lastModifiedAt: 1700000000 },
          { nope: true },
        ],
      }),
    ]);
    const docs = await h.client.listDocuments("folder-1", { folderPathById: new Map([["folder-1", "Projects/Research"]]) });
    expect(h.calls[0].url).toBe("https://connect.craft.do/links/abc/api/v1/documents?location=folder-1");
    expect(docs).toEqual([
      {
        id: "d1",
        title: "Doc one",
        folderId: "folder-1",
        folderPath: "Projects/Research",
        updatedAt: "2026-01-02T03:04:05.000Z",
        webUrl: "https://craft.do/s/x",
      },
      {
        id: "d2",
        title: "Doc two",
        folderId: "folder-1",
        folderPath: "Projects/Research",
        updatedAt: new Date(1700000000 * 1000).toISOString(),
        webUrl: undefined,
      },
    ]);
  });

  it("omits the location param for the root", async () => {
    const h = harness([jsonResponse([])]);
    await h.client.listDocuments();
    expect(h.calls[0].url).toBe("https://connect.craft.do/links/abc/api/v1/documents");
  });

  it("encodes the search query", async () => {
    const h = harness([jsonResponse({ results: [{ id: "x", title: "Hit" }] })]);
    const docs = await h.client.searchDocuments("a b&c");
    expect(h.calls[0].url).toBe("https://connect.craft.do/links/abc/api/v1/documents/search?q=a%20b%26c");
    expect(docs.map((d) => d.id)).toEqual(["x"]);
  });

  it("fetches markdown with the text/markdown accept header", async () => {
    const h = harness([textResponse("# Title\n\nBody")]);
    const md = await h.client.getDocumentMarkdown("doc/1");
    expect(h.calls[0].url).toBe("https://connect.craft.do/links/abc/api/v1/blocks?documentId=doc%2F1");
    expect((h.calls[0].init?.headers as Record<string, string>).Accept).toBe("text/markdown");
    expect(md).toBe("# Title\n\nBody");
  });

  it("extracts markdown from a JSON body when Craft ignores the accept header", async () => {
    const h = harness([jsonResponse({ blocks: [{ markdown: "# A" }, { content: "para" }] })]);
    expect(await h.client.getDocumentMarkdown("d")).toBe("# A\n\npara");
  });

  describe("retries", () => {
    it("retries on 429 then succeeds, honouring Retry-After", async () => {
      const h = harness([jsonResponse({}, 429, { "retry-after": "2" }), jsonResponse({ folders: [] })]);
      await h.client.listFolders();
      expect(h.calls).toHaveLength(2);
      // Retry-After (2000ms) wins over the jittered backoff (0.5 * 100 = 50ms).
      expect(h.sleeps).toEqual([2000]);
      expect(h.logs.map((l) => l.outcome)).toEqual(["retry", "ok"]);
    });

    it("retries on 5xx with exponential backoff and jitter", async () => {
      const h = harness([jsonResponse({}, 500), jsonResponse({}, 502), jsonResponse({}, 503), jsonResponse({ folders: [] })]);
      await h.client.listFolders();
      expect(h.calls).toHaveLength(4);
      // random=0.5: 0.5*100, 0.5*200, 0.5*400
      expect(h.sleeps).toEqual([50, 100, 200]);
    });

    it("gives up after 3 retries on 429 with CraftRateLimitedError", async () => {
      const h = harness([jsonResponse({}, 429), jsonResponse({}, 429), jsonResponse({}, 429), jsonResponse({}, 429, { "retry-after": "7" })]);
      const err = await h.client.listFolders().catch((e) => e);
      expect(err).toBeInstanceOf(CraftRateLimitedError);
      expect((err as CraftRateLimitedError).retryAfterSeconds).toBe(7);
      expect(h.calls).toHaveLength(4);
      expect(h.sleeps).toHaveLength(3);
    });

    it("gives up after 3 retries on 5xx with CraftServerError", async () => {
      const h = harness([jsonResponse({}, 500), jsonResponse({}, 500), jsonResponse({}, 500), jsonResponse({}, 500)]);
      await expect(h.client.listFolders()).rejects.toBeInstanceOf(CraftServerError);
      expect(h.calls).toHaveLength(4);
    });

    it("respects a custom maxRetries", async () => {
      const h = harness([jsonResponse({}, 500), jsonResponse({}, 500)], { maxRetries: 1 });
      await expect(h.client.listFolders()).rejects.toBeInstanceOf(CraftServerError);
      expect(h.calls).toHaveLength(2);
    });

    it("retries network errors and never leaks the key in the message", async () => {
      const h = harness([new Error(`connect ECONNRESET ${KEY}`), jsonResponse({ folders: [] })]);
      await h.client.listFolders();
      expect(h.calls).toHaveLength(2);
      expect(h.logs[0].outcome).toBe("error");
      expect(h.logs[0].error).not.toContain(KEY);
      expect(h.logs[0].error).toContain("pdk_[redacted]");
    });

    it("surfaces CraftNetworkError after retries are exhausted", async () => {
      const h = harness([new Error("boom"), new Error("boom"), new Error("boom"), new Error("boom")]);
      await expect(h.client.listFolders()).rejects.toBeInstanceOf(CraftNetworkError);
    });

    it("does not retry 401, 404 or other 4xx", async () => {
      const a = harness([jsonResponse({}, 401)]);
      await expect(a.client.listFolders()).rejects.toBeInstanceOf(CraftUnauthorizedError);
      expect(a.calls).toHaveLength(1);

      const b = harness([jsonResponse({}, 404)]);
      await expect(b.client.getDocumentMarkdown("gone")).rejects.toBeInstanceOf(CraftNotFoundError);
      expect(b.calls).toHaveLength(1);

      const c = harness([jsonResponse({}, 400)]);
      await expect(c.client.listDocuments("x")).rejects.toBeInstanceOf(CraftRequestError);
      expect(c.calls).toHaveLength(1);
    });

    it("treats 403 as unauthorized", async () => {
      const h = harness([jsonResponse({}, 403)]);
      await expect(h.client.listFolders()).rejects.toBeInstanceOf(CraftUnauthorizedError);
    });
  });

  describe("timeout", () => {
    it("aborts a slow request after the timeout and does not retry", async () => {
      vi.useFakeTimers();
      // Never resolves on its own; the client's abort signal is what rejects it.
      const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      });
      const logs: CraftLogEntry[] = [];
      const client = createCraftClient({
        baseUrl: BASE,
        apiKey: KEY,
        fetch: fetchMock as unknown as typeof fetch,
        timeoutMs: 1000,
        sleep: async () => {},
        logger: (e) => logs.push(e),
      });

      const pending = client.listFolders();
      const assertion = expect(pending).rejects.toBeInstanceOf(CraftTimeoutError);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2);
      await assertion;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(logs[0].error).toBe("timeout");
    });
  });

  it("logs latency and never the key", async () => {
    const h = harness([jsonResponse({ folders: [] })]);
    await h.client.listFolders();
    const serialised = JSON.stringify(h.logs);
    expect(serialised).not.toContain(KEY);
    expect(h.logs[0]).toMatchObject({ method: "GET", path: "/folders", status: 200, attempt: 0, outcome: "ok" });
    expect(typeof h.logs[0].latencyMs).toBe("number");
  });
});

describe("helpers", () => {
  it("backoffDelay grows exponentially with jitter", () => {
    expect(backoffDelay(0, 300, () => 1)).toBe(300);
    expect(backoffDelay(1, 300, () => 1)).toBe(600);
    expect(backoffDelay(2, 300, () => 1)).toBe(1200);
    expect(backoffDelay(2, 300, () => 0)).toBe(0);
  });

  it("parseRetryAfter handles seconds and dates", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("3")).toBe(3000);
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:05 GMT", now)).toBe(5000);
    expect(parseRetryAfter("garbage")).toBeUndefined();
  });

  it("redactKey masks pdk_ keys", () => {
    expect(redactKey("url?k=pdk_abc-123 and pdk_x")).toBe("url?k=pdk_[redacted] and pdk_[redacted]");
  });
});

// Keep the type referenced so a future refactor of the harness is caught by tsc.
export type { Harness };
