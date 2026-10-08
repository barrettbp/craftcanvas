/**
 * Typed wrapper over the Craft Connect API (connect.craft.do).
 *
 * - Base URL like `https://connect.craft.do/links/XXXX/api/v1`, bearer `pdk_` key.
 * - 10s timeout per attempt (AbortController).
 * - Retries with exponential backoff plus full jitter on 429, 5xx and network
 *   errors (max 3 retries, honours `Retry-After` on 429 up to 10s). Timeouts
 *   are not retried: four 10s attempts would hold a route open for 40s.
 * - Logs method, path and latency. The key never appears in logs or errors.
 * - Response parsing is delegated to `normalise.ts`.
 */
import {
  CraftError,
  CraftNetworkError,
  CraftNotFoundError,
  CraftRateLimitedError,
  CraftRequestError,
  CraftServerError,
  CraftTimeoutError,
  CraftUnauthorizedError,
} from "./errors";
import { extractSpaceId, normaliseDocuments, normaliseFolders, normaliseMarkdown, type DocumentContext } from "./normalise";
import type { CraftDocument, CraftFolder } from "./types";

export type CraftLogEntry = {
  method: string;
  path: string;
  status?: number;
  attempt: number;
  latencyMs: number;
  outcome: "ok" | "retry" | "error";
  error?: string;
};

export type CraftLogger = (entry: CraftLogEntry) => void;

export type CraftClientOptions = {
  baseUrl: string;
  apiKey: string;
  /** Defaults to 10 000. */
  timeoutMs?: number;
  /** Defaults to 3 (so at most 4 attempts). */
  maxRetries?: number;
  /** Base delay for backoff, defaults to 300ms. */
  backoffBaseMs?: number;
  /** Injection points for tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  logger?: CraftLogger;
};

export type CraftClient = {
  readonly baseUrl: string;
  listFolders(): Promise<CraftFolder[]>;
  /** Folders plus a space id when the payload carries one (for deep links). */
  listFoldersWithMeta(): Promise<{ folders: CraftFolder[]; spaceId?: string }>;
  /** `location` is passed through as-is (folder id or a Craft location keyword). Omit for the root. */
  listDocuments(location?: string, ctx?: DocumentContext): Promise<CraftDocument[]>;
  searchDocuments(q: string, ctx?: DocumentContext): Promise<CraftDocument[]>;
  getDocumentMarkdown(docId: string): Promise<string>;
};

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_BACKOFF_BASE_MS = 300;
const MAX_RETRY_AFTER_MS = 10_000;

const defaultLogger: CraftLogger = (entry) => {
  const parts = [`[craft] ${entry.method} ${entry.path}`, `attempt=${entry.attempt}`, `${entry.latencyMs}ms`];
  if (entry.status !== undefined) parts.push(`status=${entry.status}`);
  parts.push(entry.outcome);
  if (entry.error) parts.push(entry.error);
  const line = parts.join(" ");
  if (entry.outcome === "error") console.warn(line);
  else console.info(line);
};

/** Strips trailing slashes so paths can be appended. */
export function normaliseBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

/** Exponential backoff with full jitter: random in [0, base * 2^attempt]. */
export function backoffDelay(attempt: number, baseMs: number, random: () => number): number {
  const cap = baseMs * 2 ** attempt;
  return Math.round(random() * cap);
}

/** Parses a `Retry-After` header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function errorForStatus(status: number, retryAfterMs?: number): CraftError {
  if (status === 401 || status === 403) return new CraftUnauthorizedError();
  if (status === 404) return new CraftNotFoundError();
  if (status === 429) return new CraftRateLimitedError(retryAfterMs !== undefined ? Math.ceil(retryAfterMs / 1000) : undefined);
  if (status >= 500) return new CraftServerError(status);
  return new CraftRequestError(status);
}

/** Guards against a key leaking through an error message (e.g. a URL echoed by undici). */
export function redactKey(text: string): string {
  return text.replace(/pdk_[A-Za-z0-9_-]+/g, "pdk_[redacted]");
}

function safeMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return redactKey(raw).slice(0, 200);
}

type Attempt = { status: number; body: string; contentType: string | null; retryAfterMs?: number };

export function createCraftClient(options: CraftClientOptions): CraftClient {
  const baseUrl = normaliseBaseUrl(options.baseUrl);
  const apiKey = options.apiKey;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const log = options.logger ?? defaultLogger;

  async function attemptOnce(method: string, path: string, accept: string, attempt: number): Promise<Attempt> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const res = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, Accept: accept },
        signal: controller.signal,
        cache: "no-store",
      });
      const body = await res.text();
      return {
        status: res.status,
        body,
        contentType: res.headers.get("content-type"),
        retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
      };
    } catch (err) {
      const latencyMs = Date.now() - started;
      if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
        log({ method, path, attempt, latencyMs, outcome: "error", error: "timeout" });
        throw new CraftTimeoutError(timeoutMs);
      }
      log({ method, path, attempt, latencyMs, outcome: "error", error: safeMessage(err) });
      throw new CraftNetworkError(safeMessage(err));
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(path: string, accept = "application/json"): Promise<Attempt> {
    const method = "GET";
    const logPath = path.length > 120 ? `${path.slice(0, 117)}...` : path;

    for (let attempt = 0; ; attempt += 1) {
      const started = Date.now();
      let result: Attempt;
      try {
        result = await attemptOnce(method, path, accept, attempt);
      } catch (err) {
        if (err instanceof CraftNetworkError && attempt < maxRetries) {
          await sleep(backoffDelay(attempt, backoffBaseMs, random));
          continue;
        }
        throw err;
      }
      const latencyMs = Date.now() - started;

      if (result.status >= 200 && result.status < 300) {
        log({ method, path: logPath, status: result.status, attempt, latencyMs, outcome: "ok" });
        return result;
      }

      if (isRetryableStatus(result.status) && attempt < maxRetries) {
        log({ method, path: logPath, status: result.status, attempt, latencyMs, outcome: "retry" });
        let delay = backoffDelay(attempt, backoffBaseMs, random);
        if (result.status === 429 && result.retryAfterMs !== undefined) {
          delay = Math.max(delay, Math.min(result.retryAfterMs, MAX_RETRY_AFTER_MS));
        }
        await sleep(delay);
        continue;
      }

      log({ method, path: logPath, status: result.status, attempt, latencyMs, outcome: "error" });
      throw errorForStatus(result.status, result.retryAfterMs);
    }
  }

  function parseJson(body: string): unknown {
    if (body.trim().length === 0) return null;
    try {
      return JSON.parse(body);
    } catch {
      throw new CraftRequestError(200, "Craft returned a non JSON body");
    }
  }

  const client: CraftClient = {
    baseUrl,

    async listFoldersWithMeta() {
      const res = await request("/folders");
      const payload = parseJson(res.body);
      return { folders: normaliseFolders(payload), spaceId: extractSpaceId(payload) };
    },

    async listFolders() {
      return (await client.listFoldersWithMeta()).folders;
    },

    async listDocuments(location, ctx = {}) {
      const qs = location !== undefined && location !== "" ? `?location=${encodeURIComponent(location)}` : "";
      const res = await request(`/documents${qs}`);
      return normaliseDocuments(parseJson(res.body), { folderId: location || undefined, ...ctx });
    },

    async searchDocuments(q, ctx = {}) {
      const res = await request(`/documents/search?q=${encodeURIComponent(q)}`);
      return normaliseDocuments(parseJson(res.body), ctx);
    },

    async getDocumentMarkdown(docId) {
      const res = await request(`/blocks?documentId=${encodeURIComponent(docId)}`, "text/markdown");
      return normaliseMarkdown(res.body, res.contentType);
    },
  };

  return client;
}
