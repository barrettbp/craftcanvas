import { boardPath, request, RequestError } from "./api";
import type {
  Arrow,
  ArrowEnd,
  ArrowType,
  Asset,
  CanvasObject,
  ObjectKind,
  SearchResult,
} from "../shared/types";
export const objectsPath = (boardId: string) => `${boardPath(boardId)}/objects`;
export const assetPath = (id: string) =>
  `/api/assets/${encodeURIComponent(id)}`;
export function assetUrl(url: string) {
  const parsed = new URL(url, window.location.origin);
  if (
    parsed.origin !== window.location.origin ||
    !parsed.pathname.startsWith("/api/assets/")
  )
    throw new Error("Invalid asset URL.");
  return parsed.pathname + parsed.search;
}
export const objectApi = {
  create: (
    boardId: string,
    body: Pick<CanvasObject, "x" | "y"> & {
      kind: ObjectKind;
    } & Partial<CanvasObject>,
  ) => request<CanvasObject>(objectsPath(boardId), "POST", body),
  remove: (boardId: string, id: string) =>
    request(`${objectsPath(boardId)}/${encodeURIComponent(id)}`, "DELETE"),
  arrow: (
    boardId: string,
    body: {
      source: ArrowEnd;
      target: ArrowEnd;
      type?: ArrowType;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    },
  ) => request<Arrow>(`${boardPath(boardId)}/arrows`, "POST", body),
  patchArrow: (boardId: string, id: string, body: Partial<Arrow>) =>
    request<Arrow>(
      `${boardPath(boardId)}/arrows/${encodeURIComponent(id)}`,
      "PATCH",
      body,
    ),
  removeArrow: (boardId: string, id: string) =>
    request(`${boardPath(boardId)}/arrows/${encodeURIComponent(id)}`, "DELETE"),
  asset: (id: string) => request<Asset>(`${assetPath(id)}/meta`),
  search: (q: string, signal?: AbortSignal) =>
    request<{ results: SearchResult[] }>(
      `/api/search?q=${encodeURIComponent(q)}&limit=50&kinds=note,object,pdf_page`,
      "GET",
      undefined,
      signal,
    ),
};
export async function assetBytes(id: string) {
  const response = await fetch(assetPath(id), { credentials: "same-origin" });
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("Please sign in again.");
  }
  if (!response.ok) throw new Error(`Cannot read file (${response.status}).`);
  return response.arrayBuffer();
}
export async function upload(
  file: File,
  progress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Asset> {
  // Enforce the published limits before allocating/transporting oversized bodies.
  if (file.type === "application/pdf" && file.size > 25 * 1024 * 1024)
    throw new RequestError(413, "PDFs are limited to 25 MB.");
  if (file.type.startsWith("image/") && file.size > 10 * 1024 * 1024)
    throw new RequestError(413, "Images are limited to 10 MB.");
  const form = new FormData();
  form.append("file", file);
  if (
    ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
      file.type,
    ) &&
    file.size <= 10 * 1024 * 1024
  ) {
    const bitmap = await createImageBitmap(file);
    form.append("width", String(bitmap.width));
    form.append("height", String(bitmap.height));
    bitmap.close();
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    const abort = () => xhr.abort();
    signal?.addEventListener("abort", abort, { once: true });
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () =>
      reject(new Error("Upload interrupted. Please try again."));
    xhr.onabort = () =>
      reject(new DOMException("Upload cancelled.", "AbortError"));
    xhr.onloadend = () => signal?.removeEventListener("abort", abort);
    xhr.onload = () => {
      if (xhr.status === 401) {
        window.location.assign("/login");
        reject(new RequestError(401, "Please sign in again."));
        return;
      }
      let result;
      try {
        result = JSON.parse(xhr.responseText);
      } catch {
        const fallback =
          xhr.status === 413
            ? "File too large. Images up to 10 MB, PDFs up to 25 MB."
            : xhr.status === 415
              ? "Only PNG, JPEG, GIF, WebP images and PDF files are accepted."
              : `Upload failed (${xhr.status}). Please try again.`;
        reject(new RequestError(xhr.status, fallback));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300)
        reject(
          new RequestError(
            xhr.status,
            result.message ||
              `Upload failed (${xhr.status}): ${result.error || "try again"}`,
          ),
        );
      else resolve(result as Asset);
    };
    if (signal?.aborted) {
      reject(new DOMException("Upload cancelled.", "AbortError"));
      return;
    }
    xhr.send(form);
  });
}
