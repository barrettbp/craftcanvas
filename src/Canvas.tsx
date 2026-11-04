import {
  lazy,
  Suspense,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  NodeResizer,
  ReactFlow,
  ConnectionMode,
  applyNodeChanges,
  type Connection as FlowConnection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import type {
  Card,
  Link,
  NoteSummary,
  Section,
  Viewport,
} from "../shared/types";
import type {
  Arrow,
  ArrowEnd,
  BoardDetailV2 as CanvasBoard,
  CanvasObject,
  ObjectKind,
  SearchResult,
} from "../shared/types";
import { api, boardPath, message, request, RequestError } from "./api";
import { objectApi, upload } from "./objects-api";
import { LayoutSaver } from "./layout";
import ObjectNode, {
  ConnectionHandles,
  type ObjectFlowNode,
} from "./ObjectNode";
import ArrowEditor from "./ArrowEditor";
import SearchPanel from "./SearchPanel";
import "@xyflow/react/dist/style.css";
const NotePanel = lazy(() => import("./NotePanel"));
const PdfPanel = lazy(() => import("./PdfPanel"));
type CardData = { card: Card; note?: NoteSummary; fold: (id: string) => void };
type SectionData = {
  section: Section;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  resize: (
    id: string,
    rect: { x: number; y: number; width: number; height: number },
  ) => void;
};
type CanvasNode =
  Node<CardData, "note"> | Node<SectionData, "section"> | ObjectFlowNode;
const NoteCard = memo(function NoteCard({
  data,
  selected,
}: NodeProps<Node<CardData, "note">>) {
  return (
    <div
      className={`note-card ${selected ? "is-selected" : ""} ${data.card.folded ? "folded" : ""}`}
    >
      <ConnectionHandles />
      {!data.card.folded && (
        <div className="folder">{data.note?.folderName || "Unfiled"}</div>
      )}
      <h3>{data.note?.title || "Unavailable note"}</h3>
      <button
        className="fold-button nodrag"
        aria-label={`${data.card.folded ? "Unfold" : "Fold"} ${data.note?.title || "note"}`}
        onClick={(e) => {
          e.stopPropagation();
          data.fold(data.card.id);
        }}
      >
        {data.card.folded ? "⌄" : "⌃"}
      </button>
      {!data.card.folded && (
        <>
          <p>{data.note?.preview || "This note has no preview."}</p>
          <footer>
            <span>↗ {data.note?.linkCount || 0} links</span>
            <span>{data.card.sectionId ? "In section" : "CRAFT NOTE"}</span>
          </footer>
        </>
      )}
    </div>
  );
});
const SectionNode = memo(function SectionNode({
  data,
  selected,
}: NodeProps<Node<SectionData, "section">>) {
  return (
    <div className={`section-node ${selected ? "is-selected" : ""}`}>
      <NodeResizer
        isVisible={selected}
        color="var(--accent)"
        minWidth={300}
        minHeight={200}
        onResizeEnd={(_, rect) => data.resize(data.section.id, rect)}
      />
      <div className="section-heading">
        <span className="section-grip" title="Drag section">
          ⠿
        </span>
        <input
          className="nodrag"
          aria-label="Section name"
          key={`${data.section.id}-${data.section.name}`}
          defaultValue={data.section.name}
          maxLength={120}
          onBlur={(e) => {
            if (e.target.value.trim() !== data.section.name)
              data.rename(
                data.section.id,
                e.target.value.trim() || "Untitled section",
              );
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <button
          className="nodrag"
          aria-label={`Delete section ${data.section.name}`}
          onClick={() => data.remove(data.section.id)}
        >
          ×
        </button>
      </div>
    </div>
  );
});
const nodeTypes = { note: NoteCard, section: SectionNode, object: ObjectNode };
const CAP = 180;
type Tool = "select" | "text" | "card" | "connect";
type FocusTarget = { id: string; stamp: number };
const endpoint = (node: CanvasNode): ArrowEnd | null =>
  node.type === "section"
    ? null
    : { kind: node.type === "note" ? "card" : "object", id: node.id };
const colorValue = (color: string | null) =>
  color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#a9543c";
const normalize = (board: CanvasBoard): CanvasBoard => ({
  ...board,
  objects: board.objects || [],
  arrows: board.arrows || [],
});

export default function Canvas({
  initial,
  links,
  onBack,
  onOpenBoard,
  revision,
  onChanged,
  focus,
  navigationGuard,
}: {
  initial: CanvasBoard;
  links: Link[];
  onBack: () => void;
  onOpenBoard: (id: string, focusId?: string) => void;
  revision: number;
  onChanged: () => void;
  focus?: FocusTarget;
  navigationGuard: RefObject<(() => Promise<void>) | undefined>;
}) {
  const [board, setBoard] = useState(() => normalize(initial));
  const boardRef = useRef(board);
  boardRef.current = board;
  const [nodes, setNodes] = useState<CanvasNode[]>([]),
    [search, setSearch] = useState(false),
    [noteId, setNoteId] = useState<string>(),
    [pdf, setPdf] = useState<{ id: string; page: number }>(),
    [selected, setSelected] = useState<string>(),
    [selectedArrow, setSelectedArrow] = useState<string>(),
    [editing, setEditing] = useState<string>(),
    [tool, setTool] = useState<Tool>("select"),
    [connectFrom, setConnectFrom] = useState<ArrowEnd>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mediaStatus, setMediaStatus] = useState(""),
    [mediaRevision, setMediaRevision] = useState(0),
    [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved"),
    [viewport, setViewport] = useState<Viewport>(initial.viewport),
    [size, setSize] = useState({ width: 1200, height: 800 });
  const container = useRef<HTMLDivElement>(null),
    flow = useRef<ReactFlowInstance<CanvasNode, Edge>>(null),
    input = useRef<HTMLInputElement>(null),
    operations = useRef(0),
    mediaController = useRef<AbortController | undefined>(undefined);
  const saver = useMemo(
    () => new LayoutSaver(initial.id, setSaveState),
    [initial.id],
  );
  const run = useCallback(async (action: () => Promise<void>) => {
    operations.current++;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(message(e));
      setBoard((current) => ({ ...current }));
    } finally {
      operations.current--;
      setBusy(operations.current > 0);
    }
  }, []);
  const flush = useCallback(() => {
    void saver.flush().catch((e) => setError(message(e)));
  }, [saver]);
  const navigationBypass = useRef(false);
  const navigate = (action: () => void) => {
    if (operations.current) {
      setError("Please wait for the current upload or operation to finish.");
      return;
    }
    void run(async () => {
      await saver.flush();
      onChanged();
      navigationBypass.current = true;
      try {
        action();
      } finally {
        navigationBypass.current = false;
      }
    });
  };
  useEffect(() => {
    navigationGuard.current = async () => {
      if (operations.current && !navigationBypass.current)
        throw new Error("Please wait for the current operation to finish.");
      await saver.flush();
    };
    return () => {
      navigationGuard.current = undefined;
    };
  }, [navigationGuard, saver]);
  const openPdf = useCallback((id: string, page = 1) => {
    setPdf({ id, page });
    setNoteId(undefined);
    setSearch(false);
  }, []);
  const lastRevision = useRef(revision);
  useEffect(() => {
    if (lastRevision.current === revision) return;
    lastRevision.current = revision;
    let cancelled = false;
    api
      .board(initial.id)
      .then((fresh) => {
        if (!cancelled)
          setBoard((current) => ({ ...current, notes: fresh.notes }));
      })
      .catch((e) => {
        if (!cancelled) setError(message(e));
      });
    return () => {
      cancelled = true;
    };
  }, [revision, initial.id]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    if (container.current) observer.observe(container.current);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saver.dirty || operations.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      observer.disconnect();
      window.removeEventListener("beforeunload", beforeUnload);
      mediaController.current?.abort();
      void saver.flush().catch(() => {});
    };
  }, [saver]);
  const updateCards = useCallback(
    (changes: (Partial<Card> & { id: string })[]) => {
      const byId = new Map(changes.map((c) => [c.id, c]));
      setBoard((current) => ({
        ...current,
        cards: current.cards.map((c) => ({ ...c, ...byId.get(c.id) })),
      }));
      changes.forEach((c) => saver.card(c));
    },
    [saver],
  );
  const updateObject = useCallback(
    (id: string, changes: Partial<CanvasObject>) => {
      setBoard((current) => ({
        ...current,
        objects: current.objects.map((o) =>
          o.id === id ? { ...o, ...changes } : o,
        ),
      }));
      const { title, text, ...geometry } = changes;
      if (Object.keys(geometry).length) saver.object({ id, ...geometry });
      if (title !== undefined || text !== undefined)
        saver.edit({
          id,
          ...(title !== undefined ? { title } : {}),
          ...(text !== undefined ? { text } : {}),
        });
    },
    [saver],
  );
  const fold = useCallback(
    (id: string) => {
      const card = boardRef.current.cards.find((c) => c.id === id);
      if (card) updateCards([{ id, folded: !card.folded }]);
    },
    [updateCards],
  );
  const changeSection = useCallback(
    (id: string, changes: Partial<Section>) =>
      void run(async () => {
        const updated = await request<Section>(
          `${boardPath(initial.id)}/sections/${encodeURIComponent(id)}`,
          "PATCH",
          changes,
        );
        setBoard((current) => ({
          ...current,
          sections: current.sections.map((s) => (s.id === id ? updated : s)),
        }));
      }),
    [initial.id, run],
  );
  const renameSection = useCallback(
    (id: string, name: string) => changeSection(id, { name }),
    [changeSection],
  );
  const resizeSection = useCallback(
    (id: string, r: { x: number; y: number; width: number; height: number }) =>
      changeSection(id, { x: r.x, y: r.y, w: r.width, h: r.height }),
    [changeSection],
  );
  const removeSection = useCallback(
    (id: string) =>
      void run(async () => {
        await saver.flush();
        await request(
          `${boardPath(initial.id)}/sections/${encodeURIComponent(id)}`,
          "DELETE",
        );
        setBoard((current) => ({
          ...current,
          sections: current.sections.filter((s) => s.id !== id),
          cards: current.cards.map((c) =>
            c.sectionId === id ? { ...c, sectionId: null } : c,
          ),
          objects: current.objects.map((o) =>
            o.sectionId === id ? { ...o, sectionId: null } : o,
          ),
        }));
      }),
    [initial.id, run, saver],
  );
  const extract = useCallback(
    (id: string) =>
      void run(async () => {
        if (mediaController.current) {
          throw new Error("A file is already being processed. Please wait.");
        }
        const controller = new AbortController();
        mediaController.current = controller;
        try {
          const { extractPdf } = await import("./pdf");
          setMediaStatus(
            await extractPdf(id, setMediaStatus, controller.signal),
          );
          setMediaRevision((n) => n + 1);
        } finally {
          mediaController.current = undefined;
        }
      }),
    [run],
  );
  useEffect(() => {
    const notes = new Map(board.notes.map((note) => [note.id, note]));
    setNodes((current) => {
      const previous = new Map(current.map((n) => [n.id, n]));
      // Explicit dimensions also let Fit View include nodes never mounted by
      // viewport culling (for example, after loading a stranded viewport).
      return [
        ...board.sections.map((section) => ({
          id: section.id,
          type: "section" as const,
          position: { x: section.x, y: section.y },
          width: section.w,
          height: section.h,
          measured: { width: section.w, height: section.h },
          style: { width: section.w, height: section.h },
          zIndex: -1,
          dragHandle: ".section-grip",
          selected: selected === section.id,
          data: {
            section,
            rename: renameSection,
            remove: removeSection,
            resize: resizeSection,
          },
        })),
        ...board.cards.map((card) => ({
          id: card.id,
          type: "note" as const,
          position: previous.get(card.id)?.dragging
            ? previous.get(card.id)!.position
            : { x: card.x, y: card.y },
          width: card.w,
          height: card.folded ? 64 : card.h,
          measured: { width: card.w, height: card.folded ? 64 : card.h },
          style: { width: card.w, height: card.folded ? 64 : card.h },
          zIndex: card.z,
          selected: selected === card.id,
          data: { card, note: notes.get(card.noteId), fold },
        })),
        ...board.objects.map((object) => ({
          id: object.id,
          type: "object" as const,
          position: previous.get(object.id)?.dragging
            ? previous.get(object.id)!.position
            : { x: object.x, y: object.y },
          width: object.w,
          height: object.h,
          measured: { width: object.w, height: object.h },
          style: { width: object.w, height: object.h },
          zIndex: object.z,
          selected: selected === object.id,
          dragHandle:
            object.kind === "youtube" ? ".object-titlebar" : undefined,
          draggable: editing === object.id ? false : undefined,
          data: {
            object,
            editing: editing === object.id,
            update: updateObject,
            edit: setEditing,
            flush,
            extract,
            openPdf,
            mediaRevision,
            visible: false,
          },
        })),
      ];
    });
  }, [
    board,
    selected,
    editing,
    fold,
    renameSection,
    removeSection,
    resizeSection,
    updateObject,
    flush,
    extract,
    openPdf,
    mediaRevision,
  ]);
  const focusItem = useCallback(
    (id: string) => {
      const item =
        boardRef.current.cards.find((c) => c.id === id) ||
        boardRef.current.objects.find((o) => o.id === id);
      if (!item) {
        setError("This item is no longer on the board.");
        return;
      }
      setSelected(id);
      setSelectedArrow(undefined);
      void flow.current?.setCenter(item.x + item.w / 2, item.y + item.h / 2, {
        zoom: 1,
        duration: 250,
      });
      if ("noteId" in item) {
        setNoteId(item.noteId);
        setPdf(undefined);
      } else if (item.kind === "pdf" && item.assetId) openPdf(item.assetId);
    },
    [openPdf],
  );
  const focused = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (
      !focus ||
      focused.current === focus.stamp ||
      !nodes.length ||
      !flow.current
    )
      return;
    focused.current = focus.stamp;
    focusItem(focus.id);
  }, [focus, nodes.length, focusItem]);
  const removeSelected = useCallback(
    () =>
      void run(async () => {
        await saver.flush();
        if (selectedArrow) {
          await objectApi.removeArrow(initial.id, selectedArrow);
          setBoard((current) => ({
            ...current,
            arrows: current.arrows.filter((a) => a.id !== selectedArrow),
          }));
          setSelectedArrow(undefined);
          return;
        }
        if (!selected) return;
        const isObject = boardRef.current.objects.some(
            (o) => o.id === selected,
          ),
          isCard = boardRef.current.cards.some((c) => c.id === selected);
        if (!isObject && !isCard) return;
        if (isObject) await objectApi.remove(initial.id, selected);
        else
          await request(
            `${boardPath(initial.id)}/cards/${encodeURIComponent(selected)}`,
            "DELETE",
          );
        setBoard((current) => ({
          ...current,
          cards: current.cards.filter((c) => c.id !== selected),
          objects: current.objects.filter((o) => o.id !== selected),
          arrows: current.arrows.filter(
            (a) => a.source.id !== selected && a.target.id !== selected,
          ),
        }));
        setSelected(undefined);
        setEditing(undefined);
        setNoteId(undefined);
        setPdf(undefined);
        onChanged();
      }),
    [initial.id, selected, selectedArrow, onChanged, run, saver],
  );
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSearch(false);
        setNoteId(undefined);
        setPdf(undefined);
        setSelectedArrow(undefined);
        setTool("select");
        setConnectFrom(undefined);
        setEditing(undefined);
        flush();
      }
      if (
        (event.target instanceof Element &&
          event.target.closest(
            'input,textarea,select,button,a,[contenteditable="true"],[role="dialog"]',
          )) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.key === "Delete") {
        event.preventDefault();
        removeSelected();
      }
      const shortcuts: Record<string, Tool> = {
        t: "text",
        n: "card",
        a: "connect",
        v: "select",
      };
      if (shortcuts[event.key.toLowerCase()]) {
        event.preventDefault();
        setTool(shortcuts[event.key.toLowerCase()]);
        setConnectFrom(undefined);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [removeSelected, flush]);
  const createArrow = useCallback(
    async (connection: FlowConnection) => {
      const sourceNode = flow.current?.getNode(connection.source),
        targetNode = flow.current?.getNode(connection.target);
      const source = sourceNode && endpoint(sourceNode),
        target = targetNode && endpoint(targetNode);
      if (!source || !target || source.id === target.id) return;
      const arrow = await objectApi.arrow(initial.id, {
        source,
        target,
        type: "parent_child",
        sourceHandle: connection.sourceHandle || "right",
        targetHandle: connection.targetHandle || "left",
      });
      setBoard((current) => ({
        ...current,
        arrows: [...current.arrows, arrow],
      }));
      setSelectedArrow(arrow.id);
      setSelected(undefined);
      setTool("select");
      setConnectFrom(undefined);
    },
    [initial.id],
  );
  const patchArrow = useCallback(
    async (id: string, changes: Partial<Arrow>) => {
      const arrow = await objectApi.patchArrow(initial.id, id, changes);
      setBoard((current) => ({
        ...current,
        arrows: current.arrows.map((a) => (a.id === id ? arrow : a)),
      }));
    },
    [initial.id],
  );
  const edges = useMemo(() => {
    const cards = new Map(board.cards.map((c) => [c.noteId, c.id]));
    const result: Edge[] = [];
    links.forEach((link, i) => {
      const source = cards.get(link.sourceNoteId),
        target = link.targetNoteId && cards.get(link.targetNoteId);
      if (source && target)
        result.push({
          id: `craft-${i}`,
          source,
          target,
          sourceHandle: "right",
          targetHandle: "left",
          label: "link in Craft",
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { strokeWidth: 1.5 },
          className: "craft-edge",
          selectable: false,
          reconnectable: false,
        });
    });
    board.connections.forEach((c) => {
      const source = cards.get(c.sourceNoteId),
        target = cards.get(c.targetNoteId);
      if (source && target)
        result.push({
          id: `legacy-${c.id}`,
          source,
          target,
          sourceHandle: "right",
          targetHandle: "left",
          label:
            c.kind === "suggested"
              ? "suggested"
              : c.label || "board connection",
          style: {
            strokeWidth: 1,
            strokeDasharray: c.kind === "suggested" ? "6 5" : undefined,
          },
          selectable: false,
          reconnectable: false,
        });
    });
    board.arrows.forEach((a) => {
      const color = colorValue(a.color),
        type =
          a.type === "parent_child"
            ? "Parent → child"
            : a.type === "related"
              ? "Related"
              : "Custom";
      result.push({
        id: `arrow-${a.id}`,
        source: a.source.id,
        target: a.target.id,
        sourceHandle: a.sourceHandle || "right",
        targetHandle: a.targetHandle || "left",
        reconnectable: true,
        selected: selectedArrow === a.id,
        label: `${type}${a.label ? ` · ${a.label}` : ""}`,
        markerEnd:
          a.type === "related"
            ? undefined
            : { type: MarkerType.ArrowClosed, color },
        style: { stroke: color, strokeWidth: selectedArrow === a.id ? 3 : 2 },
        labelStyle: { fill: color, fontWeight: 650 },
        labelBgStyle: { fill: "var(--surface)", stroke: color, strokeWidth: 1 },
        labelBgPadding: [8, 5],
        labelBgBorderRadius: 5,
        className: "user-arrow",
      });
    });
    return result;
  }, [board.cards, board.connections, board.arrows, links, selectedArrow]);
  // Key by the input node, so edits naturally invalidate the derived node and
  // discarded boards/nodes can be collected. Panning preserves data identity.
  const visibilityCache = useMemo(
    () => new WeakMap<CanvasNode, CanvasNode>(),
    [],
  );
  const { visibleNodes, capped } = useMemo(() => {
    const margin = 200 / viewport.zoom,
      left = -viewport.x / viewport.zoom - margin,
      top = -viewport.y / viewport.zoom - margin,
      right = left + size.width / viewport.zoom + margin * 2,
      bottom = top + size.height / viewport.zoom + margin * 2;
    const candidates = nodes.filter(
      (n) =>
        n.type !== "section" &&
        n.position.x < right &&
        n.position.y < bottom &&
        n.position.x + Number(n.style?.width || 260) > left &&
        n.position.y + Number(n.style?.height || 160) > top,
    );
    const allowed = new Set(
        candidates
          .sort((a, b) => Number(!!b.selected) - Number(!!a.selected))
          .slice(0, CAP)
          .map((n) => n.id),
      ),
      candidateIds = new Set(candidates.map((n) => n.id));
    return {
      visibleNodes: nodes.map((n) => {
        const hidden =
          n.type !== "section" && candidateIds.has(n.id) && !allowed.has(n.id);
        const cached = visibilityCache.get(n);
        if (n.type !== "object") {
          if (cached?.hidden === hidden) return cached;
          const result = { ...n, hidden };
          visibilityCache.set(n, result);
          return result;
        }
        // React Flow briefly mounts off-screen nodes to measure their handles. Gate
        // media independently so that pass never starts PDF work or video requests.
        const visible =
          !hidden &&
          n.position.x < right - margin &&
          n.position.y < bottom - margin &&
          n.position.x + Number(n.style?.width || 260) > left + margin &&
          n.position.y + Number(n.style?.height || 160) > top + margin;
        if (
          cached?.type === "object" &&
          cached.hidden === hidden &&
          cached.data.visible === visible
        )
          return cached;
        const result = { ...n, hidden, data: { ...n.data, visible } };
        visibilityCache.set(n, result);
        return result;
      }),
      capped: Math.max(0, candidates.length - CAP),
    };
  }, [nodes, viewport, size, visibilityCache]);
  const center = useCallback(
    () => ({
      x: (size.width / 2 - viewport.x) / viewport.zoom - 130,
      y: (size.height / 2 - viewport.y) / viewport.zoom - 80,
    }),
    [size, viewport],
  );
  const createObject = useCallback(
    async (
      kind: ObjectKind,
      position: { x: number; y: number },
      extra: Partial<CanvasObject> = {},
    ) => {
      await saver.flush();
      const object = await objectApi.create(initial.id, {
        kind,
        ...position,
        ...extra,
      });
      setBoard((current) => ({
        ...current,
        objects: [...current.objects, object],
      }));
      setSelected(object.id);
      setSelectedArrow(undefined);
      setTool("select");
      if (kind === "text" || kind === "card") setEditing(object.id);
      onChanged();
      return object;
    },
    [saver, initial.id, onChanged],
  );
  const video = useRef<HTMLDialogElement>(null),
    [videoUrl, setVideoUrl] = useState(""),
    [videoError, setVideoError] = useState("");
  const receiveFiles = async (
    files: File[],
    position: { x: number; y: number },
  ) => {
    if (mediaController.current)
      throw new Error("A file is already being processed. Please wait.");
    const controller = new AbortController();
    mediaController.current = controller;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setMediaStatus(`Uploading ${file.name}…`);
        const asset = await upload(
          file,
          (percent) => setMediaStatus(`Uploading ${file.name} · ${percent}%`),
          controller.signal,
        ).catch((error) => {
          setMediaStatus("Upload failed");
          throw error;
        });
        try {
          await createObject(
            asset.kind,
            { x: position.x + i * 40, y: position.y + i * 40 },
            {
              assetId: asset.id,
              title: asset.filename,
              ...(asset.kind === "image" && asset.width && asset.height
                ? {
                    w: Math.max(180, Math.min(asset.width, 420)),
                    h:
                      Math.round(
                        (asset.height *
                          Math.max(180, Math.min(asset.width, 420))) /
                          asset.width,
                      ) + 90,
                  }
                : {}),
            },
          );
        } catch (e) {
          setMediaStatus(
            `File uploaded, but could not place it. Asset: ${asset.id}`,
          );
          throw e;
        }
        if (asset.kind === "pdf") {
          const { extractPdf } = await import("./pdf");
          try {
            setMediaStatus(
              await extractPdf(asset.id, setMediaStatus, controller.signal),
            );
            setMediaRevision((n) => n + 1);
          } catch (e) {
            setMediaStatus(
              "PDF uploaded. Text extraction failed; use Re-extract text to retry.",
            );
            throw e;
          }
        } else setMediaStatus(`${file.name} uploaded`);
      }
    } finally {
      mediaController.current = undefined;
    }
  };
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('input,textarea,[contenteditable="true"],dialog')
      )
        return;
      const text = event.clipboardData?.getData("text/plain").trim();
      if (!text) return;
      try {
        const url = new URL(text);
        if (
          url.protocol === "https:" &&
          (url.hostname === "youtu.be" ||
            /(^|\.)youtube\.com$/.test(url.hostname))
        ) {
          event.preventDefault();
          void run(async () => {
            await createObject("youtube", center(), { url: text });
          });
        }
      } catch {
        /* Plain text pastes do not create video objects. */
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [run, createObject, center]);
  const addNote = async (note: NoteSummary) => {
    try {
      const origin = center();
      let position = origin;
      const all = [...boardRef.current.cards, ...boardRef.current.objects];
      outer: for (let ring = 0; ring < 100; ring++)
        for (let row = -ring; row <= ring; row++)
          for (let column = -ring; column <= ring; column++) {
            if (Math.max(Math.abs(row), Math.abs(column)) !== ring) continue;
            const x = origin.x + column * 310,
              y = origin.y + row * 210;
            if (
              !all.some(
                (c) =>
                  x < c.x + c.w + 24 &&
                  x + 284 > c.x &&
                  y < c.y + c.h + 24 &&
                  y + 184 > c.y,
              )
            ) {
              position = { x, y };
              break outer;
            }
          }
      const card = await api.addCard(initial.id, {
        noteId: note.id,
        ...position,
      });
      setBoard((current) => ({
        ...current,
        cards: [...current.cards, card],
        notes: [...current.notes.filter((n) => n.id !== note.id), note],
      }));
      onChanged();
    } catch (e) {
      if (e instanceof RequestError && e.status === 409) {
        await saver.flush();
        setBoard(normalize(await api.board(initial.id)));
        throw new Error("Already on this board.");
      }
      throw e;
    }
  };
  const searchResult = (result: SearchResult) => {
    if (result.kind === "pdf_page" && result.assetId) {
      openPdf(result.assetId, result.page || 1);
      return;
    }
    const id = result.id.replace(/^object:/, "");
    if (boardRef.current.objects.some((o) => o.id === id)) {
      setSearch(false);
      focusItem(id);
    } else if (result.boardIds[0])
      navigate(() => onOpenBoard(result.boardIds[0], id));
    else setError("This result is no longer on a board.");
  };
  const selectedArrowData = board.arrows.find((a) => a.id === selectedArrow);
  return (
    <div className="workspace">
      <div className="board-toolbar">
        <div className="board-breadcrumb">
          <button onClick={() => navigate(onBack)} disabled={busy}>
            ← Boards
          </button>
          <span>/</span>
          <h1>{board.name}</h1>
          <span className="count-badge">
            {board.cards.length + board.objects.length}
          </span>
        </div>
        <div className="board-actions">
          <span role="status" className={`save-state ${saveState}`}>
            {saveState === "saved"
              ? "✓ All changes saved"
              : saveState === "saving"
                ? "Saving…"
                : "Changes not saved"}
          </span>
          {saveState === "error" && (
            <button onClick={() => void run(() => saver.flush())}>
              Retry save
            </button>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const section = await api.addSection(initial.id, {
                  name: "Untitled section",
                  ...center(),
                  w: 640,
                  h: 420,
                });
                setBoard((current) => ({
                  ...current,
                  sections: [...current.sections, section],
                }));
              })
            }
          >
            ▧ New section
          </button>
          <button
            className="primary"
            onClick={() => {
              setNoteId(undefined);
              setPdf(undefined);
              setSearch(true);
            }}
          >
            ⌕ Search / Add notes
          </button>
        </div>
      </div>
      <div
        className="creation-toolbar"
        role="toolbar"
        aria-label="Canvas tools"
      >
        {(["select", "text", "card", "connect"] as const).map((item, i) => (
          <button
            key={item}
            aria-pressed={tool === item}
            disabled={busy}
            onClick={() => {
              setTool(item);
              setConnectFrom(undefined);
            }}
          >
            {["↖ Select", "T Text", "▤ Card", "↗ Connect"][i]}
            <kbd>{["V", "T", "N", "A"][i]}</kbd>
          </button>
        ))}
        <span className="toolbar-divider" />
        <button disabled={busy} onClick={() => input.current?.click()}>
          ↑ Upload
        </button>
        <input
          hidden
          ref={input}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            if (files.length) void run(() => receiveFiles(files, center()));
          }}
        />
        <button
          disabled={busy}
          onClick={() => {
            setVideoUrl("");
            setVideoError("");
            video.current?.showModal();
          }}
        >
          ▷ Video
        </button>
        <span className="tool-hint">
          {tool === "text" || tool === "card"
            ? `Click the canvas to place ${tool === "text" ? "text" : "a card"}`
            : tool === "connect"
              ? connectFrom
                ? "Choose the child / target"
                : "Choose the parent, then the child"
              : "Drag files here · Double-click objects to edit"}
        </span>
      </div>
      {error && (
        <div role="alert" className="error workspace-error">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {mediaStatus && (
        <div className="media-status" role="status">
          {mediaStatus}
          {!busy && (
            <button
              aria-label="Dismiss file status"
              onClick={() => setMediaStatus("")}
            >
              ×
            </button>
          )}
        </div>
      )}
      <div className="canvas-body">
        <div
          className={`flow-container tool-${tool}`}
          ref={container}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            const files = Array.from(e.dataTransfer.files),
              point =
                flow.current?.screenToFlowPosition({
                  x: e.clientX,
                  y: e.clientY,
                }) || center();
            void run(() => receiveFiles(files, point));
          }}
        >
          <ReactFlow<CanvasNode>
            nodes={visibleNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={(instance) => {
              flow.current = instance;
              if (focus) focusItem(focus.id);
            }}
            defaultViewport={initial.viewport}
            minZoom={0.08}
            maxZoom={2.5}
            colorMode="system"
            onlyRenderVisibleElements
            connectionMode={ConnectionMode.Loose}
            deleteKeyCode={null}
            multiSelectionKeyCode={null}
            nodesDraggable={tool === "select" && !busy}
            nodesConnectable={!busy}
            edgesReconnectable={!busy}
            onConnect={(connection) => void run(() => createArrow(connection))}
            onReconnect={(edge, connection) =>
              void run(async () => {
                if (!edge.id.startsWith("arrow-")) return;
                const sourceNode = flow.current?.getNode(connection.source),
                  targetNode = flow.current?.getNode(connection.target),
                  source = sourceNode && endpoint(sourceNode),
                  target = targetNode && endpoint(targetNode);
                if (source && target && source.id !== target.id)
                  await patchArrow(edge.id.slice(6), {
                    source,
                    target,
                    sourceHandle: connection.sourceHandle,
                    targetHandle: connection.targetHandle,
                  });
              })
            }
            onNodesChange={(changes) => {
              setNodes((current) => applyNodeChanges(changes, current));
              for (const change of changes)
                if (change.type === "select" && change.selected) {
                  setSelected(change.id);
                  setSelectedArrow(undefined);
                }
            }}
            onEdgesChange={(changes) => {
              for (const change of changes)
                if (
                  change.type === "select" &&
                  change.id.startsWith("arrow-")
                ) {
                  if (change.selected) {
                    setSelectedArrow(change.id.slice(6));
                    setSelected(undefined);
                    setNoteId(undefined);
                    setPdf(undefined);
                  } else
                    setSelectedArrow((current) =>
                      current === change.id.slice(6) ? undefined : current,
                    );
                }
            }}
            onEdgeClick={(_, edge) => {
              if (edge.id.startsWith("arrow-")) {
                setSelectedArrow(edge.id.slice(6));
                setSelected(undefined);
                setNoteId(undefined);
                setPdf(undefined);
                setEditing(undefined);
              }
            }}
            onNodeClick={(_, node) => {
              if (tool === "connect") {
                const end = endpoint(node);
                if (!end) return;
                if (!connectFrom) {
                  setConnectFrom(end);
                  setSelected(node.id);
                } else if (end.id !== connectFrom.id)
                  void run(() =>
                    createArrow({
                      source: connectFrom.id,
                      target: end.id,
                      sourceHandle: "right",
                      targetHandle: "left",
                    }),
                  );
                return;
              }
              setSelected(node.id);
              setSelectedArrow(undefined);
              if (node.type === "note") {
                setNoteId(node.data.card.noteId);
                setPdf(undefined);
                setSearch(false);
              } else if (
                node.type === "object" &&
                node.data.object.kind === "pdf" &&
                node.data.object.assetId
              )
                openPdf(node.data.object.assetId);
            }}
            onPaneClick={(event) => {
              setSelected(undefined);
              setSelectedArrow(undefined);
              setEditing(undefined);
              flush();
              if (tool === "text" || tool === "card") {
                const point =
                  flow.current?.screenToFlowPosition({
                    x: event.clientX,
                    y: event.clientY,
                  }) || center();
                void run(async () => {
                  await createObject(tool, point);
                });
              }
            }}
            onMove={(_, next) => setViewport(next)}
            onMoveEnd={(_, next) => {
              setViewport(next);
              saver.view(next);
            }}
            onNodeDragStop={(_, node) => {
              if (node.type !== "section") {
                const item =
                    node.type === "note" ? node.data.card : node.data.object,
                  { x, y } = node.position;
                const section = [...boardRef.current.sections]
                  .reverse()
                  .find(
                    (s) =>
                      x + item.w / 2 >= s.x &&
                      x + item.w / 2 <= s.x + s.w &&
                      y + item.h / 2 >= s.y &&
                      y + item.h / 2 <= s.y + s.h,
                  );
                const changes = {
                  id: node.id,
                  x,
                  y,
                  sectionId: section?.id || null,
                };
                if (node.type === "note") updateCards([changes]);
                else updateObject(node.id, changes);
              } else {
                const section = boardRef.current.sections.find(
                  (s) => s.id === node.id,
                );
                if (!section) return;
                void run(async () => {
                  const updated = await request<Section>(
                    `${boardPath(initial.id)}/sections/${encodeURIComponent(node.id)}`,
                    "PATCH",
                    node.position,
                  );
                  const dx = updated.x - section.x,
                    dy = updated.y - section.y;
                  setBoard((current) => ({
                    ...current,
                    sections: current.sections.map((s) =>
                      s.id === node.id ? updated : s,
                    ),
                  }));
                  updateCards(
                    boardRef.current.cards
                      .filter((c) => c.sectionId === section.id)
                      .map((c) => ({ id: c.id, x: c.x + dx, y: c.y + dy })),
                  );
                  boardRef.current.objects
                    .filter((o) => o.sectionId === section.id)
                    .forEach((o) =>
                      updateObject(o.id, { x: o.x + dx, y: o.y + dy }),
                    );
                });
              }
            }}
          >
            <Background gap={24} size={1} />
            <Controls
              showInteractive={false}
              fitViewOptions={{
                maxZoom: 1,
                padding: 0.2,
                includeHiddenNodes: true,
              }}
            />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) =>
                node.type === "section"
                  ? "#ddd0c4"
                  : node.type === "object"
                    ? "#897264"
                    : "#bb735b"
              }
              maskColor="rgba(140,130,120,.12)"
            />
          </ReactFlow>
          {!board.cards.length &&
            !board.objects.length &&
            !board.sections.length &&
            tool === "select" && (
              <div className="canvas-empty">
                <div className="empty-art">
                  ▤ <span>↗</span> T
                </div>
                <p className="eyebrow">ROOM FOR A NEW CONNECTION</p>
                <h2>Give your ideas a little space.</h2>
                <p>
                  Write anywhere, upload a file, or add notes from search.
                  <br />
                  Your Craft notes stay read-only.
                </p>
                <button className="primary" onClick={() => setSearch(true)}>
                  + Add your first notes
                </button>
              </div>
            )}
          <div className="canvas-help">
            T Text · N Card · A Connect · Delete removes selection
          </div>
          {capped > 0 && (
            <div className="density-notice">
              Showing up to {CAP} nearby items. Zoom in to explore {capped}{" "}
              more.
            </div>
          )}
          {selected &&
            !editing &&
            board.sections.every((s) => s.id !== selected) && (
              <button
                className="remove-card"
                disabled={busy}
                onClick={removeSelected}
              >
                Remove selected{" "}
                {board.objects.some((o) => o.id === selected)
                  ? "object"
                  : "card"}
              </button>
            )}
          {selectedArrowData && (
            <ArrowEditor
              key={`${selectedArrowData.id}-${selectedArrowData.label}-${selectedArrowData.type}`}
              arrow={selectedArrowData}
              onSave={(changes) => patchArrow(selectedArrowData.id, changes)}
              onDelete={removeSelected}
              onClose={() => setSelectedArrow(undefined)}
            />
          )}
        </div>
        {search && (
          <SearchPanel
            onClose={() => setSearch(false)}
            onAdd={addNote}
            added={new Set(board.cards.map((c) => c.noteId))}
            revision={revision + mediaRevision}
            onResult={searchResult}
          />
        )}{" "}
        {noteId && (
          <Suspense fallback={<aside className="reader">Opening note…</aside>}>
            <NotePanel
              id={noteId}
              revision={revision}
              onClose={() => setNoteId(undefined)}
              onNote={setNoteId}
              onBoard={(id) => navigate(() => onOpenBoard(id))}
            />
          </Suspense>
        )}
        {pdf && (
          <Suspense fallback={<aside className="reader">Opening PDF…</aside>}>
            <PdfPanel
              assetId={pdf.id}
              initialPage={pdf.page}
              onClose={() => setPdf(undefined)}
            />
          </Suspense>
        )}
      </div>
      <dialog ref={video} aria-labelledby="video-title">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setVideoError("");
            void run(async () => {
              try {
                await createObject("youtube", center(), { url: videoUrl });
                video.current?.close();
              } catch (e) {
                setVideoError(message(e));
                throw e;
              }
            });
          }}
        >
          <h2 id="video-title">Add a YouTube video</h2>
          <label>
            YouTube URL
            <input
              autoFocus
              type="url"
              required
              aria-label="YouTube URL"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="Paste a YouTube link"
            />
          </label>
          {videoError && (
            <p className="error" role="alert">
              {videoError}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => video.current?.close()}
            >
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Adding…" : "Add video"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
