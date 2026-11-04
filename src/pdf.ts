import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { assetBytes, assetPath } from "./objects-api";
import { request } from "./api";
GlobalWorkerOptions.workerSrc = workerUrl;
// Vite emits these npm-bundled resources on this origin, including CJK maps and codecs.
const binaries = import.meta.glob<string>(
  "/node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm}/*",
  { eager: true, query: "?url&no-inline", import: "default" },
);
class LocalBinaryFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const folder = {
      cMapUrl: "cmaps",
      standardFontDataUrl: "standard_fonts",
      wasmUrl: "wasm",
    }[kind];
    const url = binaries[`/node_modules/pdfjs-dist/${folder}/${filename}`];
    if (!url) throw new Error(`PDF resource not available: ${filename}`);
    const response = await fetch(url, { credentials: "same-origin" });
    if (response.status === 401) window.location.assign("/login");
    if (!response.ok) throw new Error("Cannot load PDF rendering resources.");
    return new Uint8Array(await response.arrayBuffer());
  }
}
export async function openPdf(id: string, signal?: AbortSignal) {
  const data = await assetBytes(id);
  signal?.throwIfAborted();
  const task = getDocument({
    data,
    useWorkerFetch: false,
    BinaryDataFactory: LocalBinaryFactory,
  });
  const abort = () => {
    void task.destroy();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const doc = await task.promise;
    return {
      doc,
      destroy: async () => {
        signal?.removeEventListener("abort", abort);
        await task.destroy();
      },
    };
  } catch (e) {
    signal?.removeEventListener("abort", abort);
    await task.destroy();
    throw e;
  }
}
let active = 0;
const waiting: (() => void)[] = [];
export async function withPdf<T>(
  id: string,
  signal: AbortSignal,
  action: (pdf: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    signal.throwIfAborted();
    const handle = await openPdf(id, signal);
    try {
      return await action(handle.doc);
    } finally {
      await handle.destroy();
    }
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
export async function extractPdf(
  id: string,
  progress: (message: string) => void,
  signal: AbortSignal,
) {
  return withPdf(id, signal, async (doc) => {
    const limit = Math.min(doc.numPages, 300),
      pages: { page: number; text: string }[] = [];
    for (let page = 1; page <= limit; page++) {
      signal.throwIfAborted();
      progress(`Extracting PDF text · page ${page} of ${limit}`);
      const pdfPage = await doc.getPage(page),
        content = await pdfPage.getTextContent();
      pages.push({
        page,
        text: content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" "),
      });
      pdfPage.cleanup();
    }
    signal.throwIfAborted();
    progress("Indexing PDF text…");
    await request(
      `${assetPath(id)}/text`,
      "PUT",
      { pages, pageCount: doc.numPages },
      signal,
    );
    return doc.numPages > 300
      ? `Indexed the first 300 of ${doc.numPages} pages. Text extraction is limited to 300 pages.`
      : `PDF ready · ${doc.numPages} pages indexed`;
  });
}
