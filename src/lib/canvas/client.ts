/**
 * Browser side wrappers over `/api/canvases`. `fetchImpl` is injectable so the
 * save pipeline can be unit tested with a fake.
 */
import type { CanvasData, CanvasDetail, CanvasSummary } from "./types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export type SaveResult =
  | { kind: "saved"; version: number; updatedAt: string }
  | { kind: "conflict"; version: number }
  | { kind: "not_found" }
  | { kind: "unauthorized" }
  | { kind: "offline"; error?: unknown }
  | { kind: "error"; status: number };

/** Browsers cap keepalive request bodies at 64KB; above that a normal request is the better bet. */
const KEEPALIVE_LIMIT = 60_000;

export async function saveCanvas(
  id: string,
  data: CanvasData,
  version: number,
  fetchImpl: FetchLike = defaultFetch,
  options: { keepalive?: boolean } = {},
): Promise<SaveResult> {
  let res: Response;
  try {
    const body = JSON.stringify({ data, version });
    res = await fetchImpl(`/api/canvases/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
      keepalive: options.keepalive === true && body.length < KEEPALIVE_LIMIT,
    });
  } catch (error) {
    return { kind: "offline", error };
  }
  if (res.status === 409) {
    const body = (await safeJson(res)) as { version?: number } | undefined;
    return { kind: "conflict", version: body?.version ?? version };
  }
  if (res.status === 404) return { kind: "not_found" };
  if (res.status === 401) return { kind: "unauthorized" };
  if (!res.ok) return { kind: "error", status: res.status };
  const body = (await safeJson(res)) as { version: number; updatedAt: string };
  return { kind: "saved", version: body.version, updatedAt: body.updatedAt };
}

export async function fetchCanvas(id: string, fetchImpl: FetchLike = defaultFetch): Promise<CanvasDetail | null> {
  const res = await fetchImpl(`/api/canvases/${id}`, { method: "GET" });
  if (!res.ok) return null;
  return (await res.json()) as CanvasDetail;
}

export async function listCanvases(fetchImpl: FetchLike = defaultFetch): Promise<CanvasSummary[]> {
  const res = await fetchImpl("/api/canvases", { method: "GET" });
  if (!res.ok) throw new Error(`Failed to list canvases (${res.status})`);
  const body = (await res.json()) as { canvases: CanvasSummary[] };
  return body.canvases;
}

export async function createCanvas(title?: string, fetchImpl: FetchLike = defaultFetch): Promise<CanvasSummary> {
  const res = await fetchImpl("/api/canvases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(title ? { title } : {}),
  });
  if (!res.ok) throw new Error(`Failed to create canvas (${res.status})`);
  return (await res.json()) as CanvasSummary;
}

export async function renameCanvas(id: string, title: string, fetchImpl: FetchLike = defaultFetch): Promise<CanvasSummary> {
  const res = await fetchImpl(`/api/canvases/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`Failed to rename canvas (${res.status})`);
  return (await res.json()) as CanvasSummary;
}

export async function duplicateCanvas(id: string, fetchImpl: FetchLike = defaultFetch): Promise<CanvasSummary> {
  const res = await fetchImpl(`/api/canvases/${id}/duplicate`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to duplicate canvas (${res.status})`);
  return (await res.json()) as CanvasSummary;
}

export async function deleteCanvas(id: string, fetchImpl: FetchLike = defaultFetch): Promise<void> {
  const res = await fetchImpl(`/api/canvases/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`Failed to delete canvas (${res.status})`);
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}
