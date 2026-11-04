import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { openPdf } from "./pdf";
import { message } from "./api";
export default function PdfPanel({
  assetId,
  initialPage = 1,
  onClose,
}: {
  assetId: string;
  initialPage?: number;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy>(),
    [page, setPage] = useState(initialPage),
    [zoom, setZoom] = useState(1),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    setPage(initialPage);
  }, [initialPage]);
  useEffect(() => {
    const controller = new AbortController();
    let destroy: (() => Promise<void>) | undefined;
    setDoc(undefined);
    setError("");
    openPdf(assetId, controller.signal)
      .then((handle) => {
        destroy = handle.destroy;
        if (controller.signal.aborted) {
          void destroy();
          return;
        }
        setDoc(handle.doc);
        setPage((p) => Math.min(handle.doc.numPages, Math.max(1, p)));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => {
      controller.abort();
      void destroy?.();
    };
  }, [assetId, retry]);
  useEffect(() => {
    if (!doc) return;
    let stopped = false;
    let render: { cancel: () => void } | undefined;
    setError("");
    void doc
      .getPage(page)
      .then(async (pdfPage) => {
        if (stopped || !canvas.current) return;
        const viewport = pdfPage.getViewport({
          scale: (zoom * 360) / pdfPage.getViewport({ scale: 1 }).width,
        });
        // A fresh canvas avoids overlapping cancelled render tasks during rapid navigation.
        const buffer = document.createElement("canvas");
        buffer.width = Math.floor(viewport.width * devicePixelRatio);
        buffer.height = Math.floor(viewport.height * devicePixelRatio);
        const task = pdfPage.render({
          canvas: buffer,
          viewport,
          transform: [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0],
        });
        render = task;
        await task.promise;
        if (stopped || !canvas.current) return;
        canvas.current.width = buffer.width;
        canvas.current.height = buffer.height;
        canvas.current.style.width = `${viewport.width}px`;
        canvas.current.style.height = `${viewport.height}px`;
        canvas.current.getContext("2d")?.drawImage(buffer, 0, 0);
        pdfPage.cleanup();
      })
      .catch((e) => {
        if (!stopped) setError(message(e));
      });
    return () => {
      stopped = true;
      render?.cancel();
    };
  }, [doc, page, zoom]);
  return (
    <aside className="reader pdf-reader" aria-label="PDF viewer">
      <div className="reader-toolbar">
        <h2>PDF viewer</h2>
        <button aria-label="Close PDF" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="pdf-controls">
        <button
          aria-label="Previous PDF page"
          disabled={!doc || page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          ←
        </button>
        <span>
          Page {page} / {doc?.numPages || "…"}
        </span>
        <button
          aria-label="Next PDF page"
          disabled={!doc || page >= doc.numPages}
          onClick={() => setPage((p) => p + 1)}
        >
          →
        </button>
        <button
          aria-label="Zoom PDF out"
          disabled={zoom <= 0.5}
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
        >
          −
        </button>
        <button
          aria-label="Zoom PDF in"
          disabled={zoom >= 3}
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
        >
          +
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error} <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
        </p>
      )}
      {!doc && !error && <p role="status">Opening PDF…</p>}
      <div className="pdf-page-scroll">
        <canvas ref={canvas} aria-label={`PDF page ${page}`} />
      </div>
    </aside>
  );
}
