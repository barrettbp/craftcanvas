import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import {
  Handle,
  Position,
  NodeResizer,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import type { Asset, CanvasObject } from "../shared/types";
import { assetUrl, objectApi } from "./objects-api";
import { message } from "./api";
import SafeMarkdown from "./SafeMarkdown";
const PdfPreview = lazy(() => import("./PdfPreview"));
export type ObjectData = {
  object: CanvasObject;
  editing: boolean;
  update: (id: string, changes: Partial<CanvasObject>) => void;
  edit: (id: string | undefined) => void;
  flush: () => void;
  extract: (id: string) => void;
  openPdf: (id: string, page?: number) => void;
  mediaRevision: number;
  visible: boolean;
};
export type ObjectFlowNode = Node<ObjectData, "object">;
export function ConnectionHandles() {
  return (
    <>
      <Handle id="left" type="target" position={Position.Left} />
      <Handle id="right" type="source" position={Position.Right} />
      <Handle id="top" type="target" position={Position.Top} />
      <Handle id="bottom" type="source" position={Position.Bottom} />
    </>
  );
}
const assets = new Map<string, Promise<Asset>>();
function useAsset(id: string | null, revision: number) {
  const [asset, setAsset] = useState<Asset>(),
    [error, setError] = useState("");
  useEffect(() => {
    if (!id) return;
    let stopped = false;
    setError("");
    if (revision) assets.delete(id);
    let promise = assets.get(id);
    if (!promise) {
      promise = objectApi.asset(id);
      assets.set(id, promise);
    }
    promise
      .then((result) => {
        if (!stopped) setAsset(result);
      })
      .catch((e) => {
        assets.delete(id);
        if (!stopped) setError(message(e));
      });
    return () => {
      stopped = true;
    };
  }, [id, revision]);
  return { asset, error };
}
export default memo(function ObjectNode({
  data,
  selected,
}: NodeProps<ObjectFlowNode>) {
  const { object, editing } = data;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const { asset, error } = useAsset(
    data.visible ? object.assetId : null,
    data.mediaRevision,
  );
  useEffect(() => {
    if (editing && textarea.current) {
      textarea.current.style.height = "auto";
      textarea.current.style.height = `${Math.max(64, textarea.current.scrollHeight)}px`;
      textarea.current.focus();
    }
  }, [editing]);
  const changeText = (value: string) => {
    const input = textarea.current;
    let h = object.h;
    if (input) {
      input.style.height = "auto";
      input.style.height = `${Math.max(64, input.scrollHeight)}px`;
      h = Math.max(
        object.kind === "text" ? 88 : 180,
        input.scrollHeight + (object.kind === "card" ? 112 : 60),
      );
    }
    data.update(object.id, {
      text: value,
      ...(object.kind === "text" || object.kind === "card" ? { h } : {}),
    });
  };
  let embed: string | undefined;
  if (
    object.kind === "youtube" &&
    data.visible &&
    typeof object.meta.embedUrl === "string"
  ) {
    try {
      const url = new URL(object.meta.embedUrl);
      if (
        url.protocol === "https:" &&
        url.hostname === "www.youtube-nocookie.com" &&
        /^\/embed\/[\w-]+$/.test(url.pathname)
      )
        embed = url.href;
    } catch {
      /* Invalid metadata stays inert. */
    }
  }
  let imageUrl: string | undefined;
  try {
    if (asset) imageUrl = assetUrl(asset.url);
  } catch {
    /* Invalid asset stays inert. */
  }
  return (
    <div
      className={`canvas-object object-${object.kind} ${selected ? "is-selected" : ""} ${editing ? "editing" : ""}`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        data.edit(object.id);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          data.flush();
          data.edit(undefined);
        }
      }}
    >
      <NodeResizer
        isVisible={selected && !editing}
        color="var(--accent)"
        minWidth={180}
        minHeight={object.kind === "text" ? 64 : 140}
        onResizeEnd={(_, r) =>
          data.update(object.id, { x: r.x, y: r.y, w: r.width, h: r.height })
        }
      />
      <ConnectionHandles />
      {object.kind !== "text" && (
        <div className="object-titlebar">
          <span className="object-kind">
            {object.kind === "card" ? "CANVAS CARD" : object.kind.toUpperCase()}
          </span>
          {editing ? (
            <input
              autoFocus
              className="nodrag nowheel"
              aria-label="Object title"
              maxLength={500}
              value={object.title || ""}
              placeholder="Untitled card"
              onChange={(e) =>
                data.update(object.id, { title: e.target.value })
              }
            />
          ) : (
            <h3>
              {object.title ||
                (object.kind === "card"
                  ? "Untitled card"
                  : asset?.filename || object.kind.toUpperCase())}
            </h3>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {object.kind === "image" && data.visible && imageUrl && (
        <img
          className="object-image"
          draggable={false}
          src={imageUrl}
          alt={
            object.text || object.title || asset?.filename || "Uploaded image"
          }
        />
      )}
      {object.kind === "pdf" && data.visible && object.assetId && (
        <>
          <button
            className="pdf-open nodrag"
            aria-label={`Open PDF ${object.title || asset?.filename || ""}`}
            onClick={() => data.openPdf(object.assetId!)}
          >
            <Suspense fallback={<span>Loading PDF…</span>}>
              <PdfPreview assetId={object.assetId} />
            </Suspense>
          </button>
          <button
            className="extract-button nodrag"
            onClick={() => data.extract(object.assetId!)}
          >
            Re-extract text
          </button>
        </>
      )}
      {object.kind === "youtube" &&
        data.visible &&
        (embed ? (
          <iframe
            className="nodrag nowheel"
            src={embed}
            title={object.title || "YouTube video"}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <p>Video embed unavailable.</p>
        ))}
      {editing ? (
        <textarea
          ref={textarea}
          maxLength={100000}
          autoFocus
          className="object-editor nodrag nowheel"
          aria-label={
            object.kind === "text"
              ? "Text content"
              : object.kind === "card"
                ? "Card body"
                : "Caption"
          }
          placeholder={
            object.kind === "text"
              ? "Write anywhere…"
              : object.kind === "card"
                ? "Write your ideas in Markdown…"
                : "Add a caption…"
          }
          value={object.text || ""}
          onChange={(e) => changeText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              data.flush();
              data.edit(undefined);
            }
          }}
        />
      ) : (
        <div className="object-copy">
          <SafeMarkdown
            text={
              object.text ||
              (object.kind === "text" || object.kind === "card"
                ? "Double-click to write…"
                : "")
            }
          />
        </div>
      )}
      {selected && !editing && (
        <button
          className="object-edit nodrag"
          aria-label="Edit object"
          onClick={() => data.edit(object.id)}
        >
          Edit
        </button>
      )}
    </div>
  );
});
