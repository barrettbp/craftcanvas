/**
 * Read-only Craft API client. GET only. Paces requests and honours 429 Retry-After.
 * The connection URL is a credential: it is never logged and never appears in thrown error messages.
 */
import { sleep } from "../util";
import {
  blocksToMarkdown,
  flattenFolders,
  normalizeDocumentRef,
  pickString,
  type DocRef,
  type FolderRef,
  type RawDocument,
} from "./parse";

export type CraftClientOptions = {
  connectionUrl: string;
  token?: string;
  /** Minimum gap between requests in ms. 700 ms keeps us under 100/min with headroom for other clients. */
  minGapMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
};

export class CraftApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    message: string,
  ) {
    super(message);
    this.name = "CraftApiError";
  }
}

export class CraftClient {
  private base: string;
  private token?: string;
  private minGapMs: number;
  private maxRetries: number;
  private lastRequestAt = 0;
  private fetchImpl: typeof fetch;

  constructor(opts: CraftClientOptions) {
    this.base = opts.connectionUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.minGapMs = opts.minGapMs ?? 700;
    this.maxRetries = opts.maxRetries ?? 4;
    // Workers require fetch to be invoked on the global; storing it on `this` would throw "Illegal invocation".
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  private async request(path: string, params: Record<string, string> = {}, accept = "application/json"): Promise<Response> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const headers: Record<string, string> = { accept };
    if (this.token) headers.authorization = `Bearer ${this.token}`;

    for (let attempt = 0; ; attempt++) {
      const wait = this.lastRequestAt + this.minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();

      const res = await this.fetchImpl(url.toString(), { method: "GET", headers });
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= this.maxRetries) {
          throw new CraftApiError(res.status, path, `Craft API ${res.status} on ${path} after ${attempt + 1} attempts`);
        }
        const ra = res.headers.get("retry-after");
        const raMs = ra ? (Number.isFinite(Number(ra)) ? Number(ra) * 1000 : Math.max(0, Date.parse(ra) - Date.now())) : NaN;
        const backoff = Number.isFinite(raMs) ? Math.min(raMs, 60_000) : Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500;
        await res.body?.cancel();
        await sleep(backoff);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new CraftApiError(res.status, path, `Craft API ${res.status} on ${path}`);
      }
      return res;
    }
  }

  private async json(path: string, params?: Record<string, string>): Promise<unknown> {
    const res = await this.request(path, params, "application/json");
    return res.json();
  }

  /** GET /connection → space id and name. Field names are normalised defensively. */
  async getConnection(): Promise<{ spaceId: string | null; spaceName: string | null }> {
    const data = (await this.json("/connection")) as Record<string, unknown>;
    const space = (data?.space ?? data) as Record<string, unknown>;
    return {
      spaceId: pickString(space, ["id", "spaceId"]) ?? pickString(data, ["spaceId"]),
      spaceName: pickString(space, ["name", "spaceName"]),
    };
  }

  async listFolders(): Promise<FolderRef[]> {
    const data = (await this.json("/folders")) as Record<string, unknown>;
    return flattenFolders(data?.items ?? data?.folders ?? data);
  }

  /** GET /documents for one folder (recursive) or a built-in location. */
  async listDocuments(opts: { folderId?: string; location?: string } = {}): Promise<DocRef[]> {
    const params: Record<string, string> = { fetchMetadata: "true" };
    if (opts.folderId) params.folderId = opts.folderId;
    if (opts.location) params.location = opts.location;
    const data = (await this.json("/documents", params)) as Record<string, unknown>;
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    const out: DocRef[] = [];
    for (const it of items) {
      const ref = normalizeDocumentRef(it);
      if (ref) out.push(ref);
    }
    return out;
  }

  /** Raw list items with metadata so the sync can read createdAt/lastModifiedAt/clickableLink. */
  async listDocumentsRaw(opts: { folderId?: string; location?: string } = {}): Promise<Record<string, unknown>[]> {
    const params: Record<string, string> = { fetchMetadata: "true" };
    if (opts.folderId) params.folderId = opts.folderId;
    if (opts.location) params.location = opts.location;
    const data = (await this.json("/documents", params)) as Record<string, unknown>;
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    return items.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null);
  }

  /** Full document as markdown plus every block id. Tries JSON first; falls back to text/markdown. */
  async getDocument(ref: DocRef, meta?: Record<string, unknown>): Promise<RawDocument> {
    let markdown = "";
    let blockIds: string[] = [ref.id];
    let title = ref.title;

    try {
      const json = await this.json("/blocks", { id: ref.id, maxDepth: "-1", fetchMetadata: "true" });
      const walked = blocksToMarkdown((json as Record<string, unknown>)?.blocks ?? (json as Record<string, unknown>)?.items ?? json);
      markdown = walked.markdown;
      blockIds = Array.from(new Set([ref.id, ...walked.blockIds]));
      if (walked.title) title = walked.title;
    } catch (e) {
      // A non-JSON 200 body (SyntaxError) or a non-429 HTTP error falls through to the markdown request.
      if (e instanceof CraftApiError && e.status !== 429) {
        /* fall through */
      } else if (!(e instanceof SyntaxError)) {
        throw e;
      }
    }

    if (!markdown.trim()) {
      const res = await this.request("/blocks", { id: ref.id, maxDepth: "-1" }, "text/markdown");
      markdown = await res.text();
    }

    const m = meta ?? {};
    return {
      id: ref.id,
      title,
      folderId: ref.folderId,
      folderName: ref.folderName,
      createdAt: pickString(m, ["createdAt", "createdDate", "created"]),
      modifiedAt: pickString(m, ["lastModifiedAt", "modifiedAt", "lastModifiedDate", "updatedAt"]),
      markdown,
      blockIds,
      deepLinkApp: pickString(m, ["clickableLink", "deepLink"]),
    };
  }
}
