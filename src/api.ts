import type {
  ApiError,
  Board,
  BoardDetailV2,
  Card,
  Link,
  Note,
  NoteSummary,
  Section,
  SyncResult,
  SyncStatus,
} from "../shared/types";

export class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (!path.startsWith("/api/"))
    throw new Error("Only same-origin API requests are allowed.");
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    signal,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) {
    window.location.assign("/login");
    throw new RequestError(401, "Please sign in again.");
  }
  if (!response.ok) {
    const error: ApiError = await response
      .json()
      .catch(() => ({ error: "request_failed" }));
    throw new RequestError(
      response.status,
      error.message || `Request failed (${response.status}). Please try again.`,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const boardPath = (id: string) =>
  `/api/boards/${encodeURIComponent(id)}`;
export const api = {
  boards: () => request<{ items: Board[] }>("/api/boards"),
  board: (id: string) => request<BoardDetailV2>(boardPath(id)),
  notes: (q: string, offset = 0, signal?: AbortSignal) =>
    request<{ items: NoteSummary[]; total: number }>(
      `/api/notes?q=${encodeURIComponent(q)}&limit=50&offset=${offset}`,
      "GET",
      undefined,
      signal,
    ),
  note: (id: string, signal?: AbortSignal) =>
    request<Note>(
      `/api/notes/${encodeURIComponent(id)}`,
      "GET",
      undefined,
      signal,
    ),
  links: () => request<{ items: Link[] }>("/api/links"),
  status: () => request<SyncStatus>("/api/sync/status"),
  sync: (cursor?: string) =>
    request<SyncResult>("/api/sync", "POST", cursor ? { cursor } : {}),
  addCard: (id: string, body: Pick<Card, "noteId" | "x" | "y">) =>
    request<Card>(`${boardPath(id)}/cards`, "POST", body),
  addSection: (
    id: string,
    body: Pick<Section, "name" | "x" | "y" | "w" | "h">,
  ) => request<Section>(`${boardPath(id)}/sections`, "POST", body),
};
export const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
