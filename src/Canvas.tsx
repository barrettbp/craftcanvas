import {
  lazy,
  Suspense,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import type {
  BoardDetail,
  Card,
  Link,
  NoteSummary,
  Section,
  Viewport,
} from "../shared/types";
import { api, boardPath, message, request, RequestError } from "./api";
import { LayoutSaver } from "./layout";
const NotePanel = lazy(() => import("./NotePanel"));
import SearchPanel from "./SearchPanel";
import "@xyflow/react/dist/style.css";

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
type CanvasNode = Node<CardData, "note"> | Node<SectionData, "section">;
const NoteCard = memo(function NoteCard({
  data,
  selected,
}: NodeProps<Node<CardData, "note">>) {
  return (
    <div
      className={`note-card ${selected ? "is-selected" : ""} ${data.card.folded ? "folded" : ""}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
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
      <Handle type="source" position={Position.Right} isConnectable={false} />
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
const nodeTypes = { note: NoteCard, section: SectionNode };
const CAP = 180;

export default function Canvas({
  initial,
  links,
  onBack,
  onOpenBoard,
  revision,
  onChanged,
}: {
  initial: BoardDetail;
  links: Link[];
  onBack: () => void;
  onOpenBoard: (id: string) => void;
  revision: number;
  onChanged: () => void;
}) {
  const [board, setBoard] = useState(initial);
  const boardRef = useRef(board);
  boardRef.current = board;
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [search, setSearch] = useState(false);
  const [noteId, setNoteId] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [busy, setBusy] = useState(false);
  const [viewport, setViewport] = useState<Viewport>(initial.viewport);
  const [size, setSize] = useState({ width: 1200, height: 800 });
  const container = useRef<HTMLDivElement>(null);
  const flow = useRef<ReactFlowInstance<CanvasNode, Edge>>(null);
  const saver = useMemo(
    () => new LayoutSaver(initial.id, setSaveState),
    [initial.id],
  );
  const operation = useRef(false);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(message(e));
      setBoard((current) => ({ ...current }));
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }, []);
  const navigate = (action: () => void) =>
    void run(async () => {
      await saver.flush();
      onChanged();
      action();
    });
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    if (container.current) observer.observe(container.current);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saver.dirty || operation.current) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      observer.disconnect();
      window.removeEventListener("beforeunload", beforeUnload);
      void saver.flush().catch(() => {});
    };
  }, [saver]);
  const updateCards = useCallback(
    (changes: (Partial<Card> & { id: string })[]) => {
      const byId = new Map(changes.map((change) => [change.id, change]));
      setBoard((current) => ({
        ...current,
        cards: current.cards.map((card) => ({ ...card, ...byId.get(card.id) })),
      }));
      changes.forEach((change) => saver.card(change));
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
        const section = await request<Section>(
          `${boardPath(initial.id)}/sections/${encodeURIComponent(id)}`,
          "PATCH",
          changes,
        );
        setBoard((current) => ({
          ...current,
          sections: current.sections.map((s) => (s.id === id ? section : s)),
        }));
      }),
    [initial.id, run],
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
        }));
      }),
    [initial.id, run, saver],
  );
  const renameSection = useCallback(
    (id: string, name: string) => changeSection(id, { name }),
    [changeSection],
  );
  const resizeSection = useCallback(
    (
      id: string,
      rect: { x: number; y: number; width: number; height: number },
    ) =>
      changeSection(id, {
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height,
      }),
    [changeSection],
  );
  useEffect(() => {
    const notes = new Map(board.notes.map((note) => [note.id, note]));
    setNodes((current) => {
      const selectedNodes = new Set(
        current.filter((node) => node.selected).map((node) => node.id),
      );
      return [
        ...board.sections.map((section) => ({
          id: section.id,
          type: "section" as const,
          position: { x: section.x, y: section.y },
          style: { width: section.w, height: section.h },
          zIndex: -1,
          dragHandle: ".section-grip",
          selected: selectedNodes.has(section.id),
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
          position: { x: card.x, y: card.y },
          style: { width: card.w, height: card.folded ? 64 : card.h },
          zIndex: card.z,
          selected: selectedNodes.has(card.id),
          data: { card, note: notes.get(card.noteId), fold },
        })),
      ];
    });
  }, [board, fold, renameSection, removeSection, resizeSection]);
  const removeCard = useCallback(
    (id: string) =>
      void run(async () => {
        await saver.flush();
        await request(
          `${boardPath(initial.id)}/cards/${encodeURIComponent(id)}`,
          "DELETE",
        );
        setBoard((current) => ({
          ...current,
          cards: current.cards.filter((card) => card.id !== id),
        }));
        setSelected(undefined);
        setNoteId(undefined);
        onChanged();
      }),
    [initial.id, onChanged, run, saver],
  );
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSearch(false);
        setNoteId(undefined);
      }
      if (
        (event.target as HTMLElement).closest(
          'input, textarea, select, button, a, [contenteditable="true"], [role="dialog"]',
        )
      )
        return;
      if (event.key === "Delete" && selected) {
        event.preventDefault();
        removeCard(selected);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [selected, removeCard]);
  const edges = useMemo(() => {
    const cards = new Map(board.cards.map((card) => [card.noteId, card.id]));
    const result: Edge[] = [];
    links.forEach((link, index) => {
      const source = cards.get(link.sourceNoteId),
        target = link.targetNoteId && cards.get(link.targetNoteId);
      if (source && target)
        result.push({
          id: `craft-${index}`,
          source,
          target,
          label: "link in Craft",
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { strokeWidth: 1.5 },
          className: "craft-edge",
        });
    });
    board.connections.forEach((connection) => {
      const source = cards.get(connection.sourceNoteId),
        target = cards.get(connection.targetNoteId);
      if (source && target)
        result.push({
          id: connection.id,
          source,
          target,
          label:
            connection.kind === "suggested"
              ? "suggested"
              : connection.label || "board connection",
          markerEnd: { type: MarkerType.ArrowClosed },
          style: {
            strokeWidth: 1,
            strokeDasharray:
              connection.kind === "suggested" ? "6 5" : undefined,
          },
        });
    });
    return result;
  }, [board.cards, board.connections, links]);
  // React Flow culls off-screen DOM. At far zoom, additionally cap visible cards.
  // Keep off-screen nodes in the graph so the minimap and fit-view retain the whole board.
  const { visibleNodes, capped } = useMemo(() => {
    let count = 0;
    const margin = 200 / viewport.zoom;
    const left = -viewport.x / viewport.zoom - margin,
      top = -viewport.y / viewport.zoom - margin;
    const right = left + size.width / viewport.zoom + margin * 2,
      bottom = top + size.height / viewport.zoom + margin * 2;
    const candidates = nodes.filter(
      (n) =>
        n.type === "note" &&
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
    );
    const candidateIds = new Set(candidates.map((n) => n.id));
    return {
      visibleNodes: nodes.map((n) => {
        const hidden =
          n.type === "note" && candidateIds.has(n.id) && !allowed.has(n.id);
        if (hidden) count++;
        return { ...n, hidden };
      }),
      capped: count,
    };
  }, [nodes, viewport, size]);
  const center = () => ({
    x: (size.width / 2 - viewport.x) / viewport.zoom - 130,
    y: (size.height / 2 - viewport.y) / viewport.zoom - 80,
  });
  const addNote = async (note: NoteSummary) => {
    try {
      const origin = center();
      let position = origin;
      // Find the nearest empty grid slot; new notes should never bury existing cards.
      const occupied = (x: number, y: number) =>
        boardRef.current.cards.some(
          (card) =>
            x < card.x + card.w + 24 &&
            x + 284 > card.x &&
            y < card.y + (card.folded ? 64 : card.h) + 24 &&
            y + 184 > card.y,
        );
      outer: for (let ring = 0; ring < 100; ring++) {
        for (let row = -ring; row <= ring; row++) {
          for (let column = -ring; column <= ring; column++) {
            if (Math.max(Math.abs(row), Math.abs(column)) !== ring) continue;
            const x = origin.x + column * 310,
              y = origin.y + row * 210;
            if (!occupied(x, y)) {
              position = { x, y };
              break outer;
            }
          }
        }
      }
      const card = await api.addCard(initial.id, {
        noteId: note.id,
        x: position.x,
        y: position.y,
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
        setBoard(await api.board(initial.id));
        throw new Error("Already on this board.");
      }
      throw e;
    }
  };
  return (
    <div className="workspace">
      <div className="board-toolbar">
        <div className="board-breadcrumb">
          <button onClick={() => navigate(onBack)} disabled={busy}>
            ← Boards
          </button>
          <span>/</span>
          <h1>{board.name}</h1>
          <span className="count-badge">{board.cards.length}</span>
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
                const position = center();
                const section = await api.addSection(initial.id, {
                  name: "Untitled section",
                  ...position,
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
              setSearch(true);
            }}
          >
            + Add notes
          </button>
        </div>
      </div>
      {error && (
        <div className="error workspace-error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      <div className="canvas-body">
        <div className="flow-container" ref={container}>
          <ReactFlow<CanvasNode>
            nodes={visibleNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={(instance) => {
              flow.current = instance;
            }}
            defaultViewport={initial.viewport}
            minZoom={0.08}
            maxZoom={2.5}
            colorMode="system"
            onlyRenderVisibleElements
            nodesConnectable={false}
            deleteKeyCode={null}
            multiSelectionKeyCode={null}
            onNodesChange={(changes) => {
              setNodes((current) => applyNodeChanges(changes, current));
              for (const change of changes)
                if (change.type === "select" && change.selected)
                  setSelected(
                    boardRef.current.cards.some((c) => c.id === change.id)
                      ? change.id
                      : undefined,
                  );
            }}
            onNodeClick={(_, node) => {
              if (node.type === "note") {
                setSelected(node.id);
                setNoteId(node.data.card.noteId);
                setSearch(false);
              }
            }}
            onPaneClick={() => setSelected(undefined)}
            onMove={(_, next) => setViewport(next)}
            onMoveEnd={(_, next) => {
              setViewport(next);
              saver.view(next);
            }}
            onNodeDragStop={(_, node) => {
              if (node.type === "note") {
                const { x, y } = node.position;
                const section = [...boardRef.current.sections]
                  .reverse()
                  .find(
                    (s) =>
                      x + node.data.card.w / 2 >= s.x &&
                      x + node.data.card.w / 2 <= s.x + s.w &&
                      y + (node.data.card.folded ? 64 : node.data.card.h) / 2 >=
                        s.y &&
                      y + (node.data.card.folded ? 64 : node.data.card.h) / 2 <=
                        s.y + s.h,
                  );
                updateCards([
                  { id: node.id, x, y, sectionId: section?.id || null },
                ]);
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
                });
              }
            }}
          >
            <Background gap={24} size={1} />
            <Controls
              showInteractive={false}
              fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
            />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) =>
                node.type === "section" ? "#ddd0c4" : "#bb735b"
              }
              maskColor="rgba(140, 130, 120, .12)"
            />
          </ReactFlow>
          {!board.cards.length && !board.sections.length && (
            <div className="canvas-empty">
              <div className="empty-art">
                ▤ <span>↗</span> ▤
              </div>
              <p className="eyebrow">ROOM FOR A NEW CONNECTION</p>
              <h2>Give your notes a little space.</h2>
              <p>
                Add notes from search, then move them around.
                <br />
                Links from Craft will find their way here.
              </p>
              <button className="primary" onClick={() => setSearch(true)}>
                + Add your first notes
              </button>
            </div>
          )}
          <div className="canvas-help">
            Drag to arrange · Scroll to zoom · Delete removes a card
          </div>
          {capped > 0 && (
            <div className="density-notice" role="status">
              Showing up to {CAP} nearby cards. Zoom in to explore {capped}{" "}
              more.
            </div>
          )}
          {selected && (
            <button
              className="remove-card"
              disabled={busy}
              onClick={() => removeCard(selected)}
            >
              Remove selected card
            </button>
          )}
        </div>
        {search && (
          <SearchPanel
            onClose={() => setSearch(false)}
            onAdd={addNote}
            added={new Set(board.cards.map((c) => c.noteId))}
            revision={revision}
          />
        )}
        {noteId && (
          <Suspense fallback={<aside className="reader">Opening note…</aside>}>
            <NotePanel
              id={noteId}
              onClose={() => setNoteId(undefined)}
              onNote={setNoteId}
              onBoard={(id) => navigate(() => onOpenBoard(id))}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
