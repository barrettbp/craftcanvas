import { useEffect, useRef, useState } from "react";
import { message } from "./api";
import { withPdf } from "./pdf";
export default function PdfPreview({
  assetId,
  mediaRevision,
}: {
  assetId: string;
  mediaRevision: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [status, setStatus] = useState("Loading first page…");
  useEffect(() => {
    const controller = new AbortController();
    let render: { cancel: () => void } | undefined;
    void withPdf(
      assetId,
      controller.signal,
      async (doc) => {
        const page = await doc.getPage(1);
        controller.signal.throwIfAborted();
        const viewport = page.getViewport({
          scale: 300 / page.getViewport({ scale: 1 }).width,
        });
        const element = canvas.current;
        if (!element) return;
        element.width = Math.floor(viewport.width);
        element.height = Math.floor(viewport.height);
        const task = page.render({ canvas: element, viewport });
        render = task;
        await task.promise;
        if (!controller.signal.aborted)
          setStatus(`${doc.numPages} ${doc.numPages === 1 ? "page" : "pages"}`);
      },
      mediaRevision,
    ).catch((e) => {
      if (!controller.signal.aborted) setStatus(message(e));
    });
    return () => {
      render?.cancel();
      controller.abort();
    };
  }, [assetId, mediaRevision]);
  return (
    <div className="pdf-preview">
      <canvas ref={canvas} aria-label="PDF first page" />
      <span>{status}</span>
    </div>
  );
}
