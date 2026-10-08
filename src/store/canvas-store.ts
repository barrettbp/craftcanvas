/**
 * Canvas store (spec section 10, "Client state").
 *
 * Holds the React Flow nodes and edges for the open canvas, the viewport,
 * selection, dirty flag, save state and an undo/redo history of up to 100
 * steps. History is grouped: a drag or a resize is one step (batched between
 * the first `dragging: true` change and the `dragging: false` change) and
 * typing in a text card is coalesced while keystrokes keep coming.
 *
 * Node and edge shapes are the React Flow ones from `@/lib/canvas/convert`;
 * `getCanvasData()` turns them back into the JSON Canvas document for saving.
 */
import {
  applyEdgeChanges as rfApplyEdgeChanges,
  applyNodeChanges as rfApplyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";
import { create } from "zustand";

import type { SaveState } from "@/lib/canvas/autosave";
import {
  absoluteRects,
  attachParents,
  decorateEdge,
  EDGE_TYPE,
  edgeToFlow,
  nodeToFlow,
  fromFlow,
  toFlow,
  type EdgeData,
  type FileNodeData,
  type FlowEdge,
  type FlowNode,
  type GroupNodeData,
  type TextNodeData,
} from "@/lib/canvas/convert";
import { padRect, pickSides, snapToGrid, unionRect, type Rect } from "@/lib/canvas/geometry";
import { newId } from "@/lib/canvas/schema";
import {
  DEFAULT_SIZES,
  GRID_SIZE,
  type CanvasData,
  type CanvasDetail,
  type CanvasNode,
  type EdgeEnd,
  type FileNodeExtension,
  type NodeSide,
} from "@/lib/canvas/types";

export type { SaveState } from "@/lib/canvas/autosave";

export const HISTORY_LIMIT = 100;
/** Keystrokes closer together than this are one undo step. */
export const COALESCE_MS = 1500;

export type Snapshot = { nodes: FlowNode[]; edges: FlowEdge[] };

export type HistoryState = {
  past: Snapshot[];
  future: Snapshot[];
  /** Open batch: the snapshot taken when it began, and whether anything changed since. */
  batch: { snapshot: Snapshot; mutated: boolean } | null;
  lastKey: string | null;
  lastAt: number;
};

export type Selection = { nodeIds: string[]; edgeIds: string[] };

export type EdgeDirection = "oneway" | "both" | "none";

export type LoadInput = { id: string; title: string; version: number; data: CanvasData };

type MutateOptions = {
  /** Record an undo step (default true). */
  history?: boolean;
  /** Coalesce with the previous step when it has the same key and is recent. */
  key?: string;
  /** Mark the document dirty (default true). */
  dirty?: boolean;
};

export type CanvasStore = {
  canvasId: string | null;
  title: string;
  version: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: Viewport;
  grid: boolean;
  selection: Selection;
  dirty: boolean;
  /** Increments on every change that needs saving. */
  changeSeq: number;
  saveState: SaveState;
  lastSavedAt: number | null;
  history: HistoryState;
  canUndo: boolean;
  canRedo: boolean;

  // lifecycle
  load: (input: LoadInput) => void;
  replaceFromServer: (detail: CanvasDetail) => void;
  setTitle: (title: string) => void;
  getCanvasData: () => CanvasData;

  // React Flow change handlers
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void;
  onConnect: (connection: Connection) => void;

  // nodes
  addTextNode: (position: { x: number; y: number }, text?: string) => string;
  addGroupNode: (rect: Rect, label?: string) => string;
  addFileNode: (ext: FileNodeExtension, position: { x: number; y: number }) => string;
  addCanvasNode: (node: CanvasNode) => string;
  setNodeText: (id: string, text: string) => void;
  setNodeSize: (id: string, size: { width: number; height?: number }, manual?: boolean) => void;
  setGroupLabel: (id: string, label: string) => void;
  updateNodeData: (id: string, patch: Partial<FlowNode["data"]>, options?: MutateOptions) => void;
  removeNodes: (ids: string[]) => void;
  removeSelected: () => void;
  setNodesColor: (ids: string[], color: string | undefined) => void;
  setSelectionColor: (color: string | undefined) => void;
  wrapSelectionInGroup: () => string | null;
  duplicateNodes: (ids: string[], options?: { offset?: number; selectClones?: boolean }) => string[];
  duplicateSelected: () => string[];
  nudgeSelected: (dx: number, dy: number) => void;
  reparentNodes: () => void;

  // edges
  addEdge: (fromNode: string, toNode: string, sides?: { fromSide: NodeSide; toSide: NodeSide }) => string | null;
  connectSelected: () => string | null;
  updateEdgeData: (id: string, patch: Partial<EdgeData>, options?: MutateOptions) => void;
  setEdgeLabel: (id: string, label: string) => void;
  setEdgeDirection: (id: string, direction: EdgeDirection) => void;
  setEdgesColor: (ids: string[], color: string | undefined) => void;
  removeEdges: (ids: string[]) => void;

  // selection
  selectAll: () => void;
  clearSelection: () => void;
  select: (nodeIds: string[], edgeIds?: string[], additive?: boolean) => void;
  getSelectedNodes: () => FlowNode[];

  // viewport and settings
  setViewport: (viewport: Viewport) => void;
  setGrid: (grid: boolean) => void;

  // history
  undo: () => void;
  redo: () => void;
  beginBatch: () => void;
  endBatch: () => void;
  breakCoalescing: () => void;

  // save pipeline
  setSaveState: (state: SaveState) => void;
  markSaved: (version: number, seq: number) => void;
};

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

function emptyHistory(): HistoryState {
  return { past: [], future: [], batch: null, lastKey: null, lastAt: 0 };
}

function pushLimited(list: Snapshot[], item: Snapshot): Snapshot[] {
  const next = [...list, item];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

function deriveSelection(nodes: FlowNode[], edges: FlowEdge[], prev: Selection): Selection {
  const nodeIds = nodes.filter((n) => n.selected).map((n) => n.id);
  const edgeIds = edges.filter((e) => e.selected).map((e) => e.id);
  if (sameList(nodeIds, prev.nodeIds) && sameList(edgeIds, prev.edgeIds)) return prev;
  return { nodeIds, edgeIds };
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Flattens parent relative positions into absolute ones and drops `parentId`. */
function withAbsolutePositions(nodes: FlowNode[]): FlowNode[] {
  const rects = absoluteRects(nodes);
  return nodes.map((n) => {
    const r = rects.get(n.id)!;
    const next = { ...n, position: { x: r.x, y: r.y } } as FlowNode;
    delete next.parentId;
    return next;
  });
}

function edgeExists(edges: FlowEdge[], source: string, target: string): boolean {
  return edges.some((e) => (e.source === source && e.target === target) || (e.source === target && e.target === source));
}

export const useCanvasStore = create<CanvasStore>()((set, get) => {
  /**
   * Core mutation: applies `next`, records history and marks dirty according
   * to `options`. Returns nothing; everything goes through `set`.
   */
  function mutate(next: Partial<Snapshot>, options: MutateOptions = {}) {
    set((s) => {
      const nodes = next.nodes ?? s.nodes;
      const edges = next.edges ?? s.edges;
      const patch: Partial<CanvasStore> = { nodes, edges, selection: deriveSelection(nodes, edges, s.selection) };
      const recordHistory = options.history !== false;
      if (recordHistory) {
        patch.history = recordStep(s.history, { nodes: s.nodes, edges: s.edges }, options.key);
        patch.canUndo = patch.history.past.length > 0;
        patch.canRedo = false;
      }
      if (options.dirty !== false) {
        patch.dirty = true;
        patch.changeSeq = s.changeSeq + 1;
      }
      return patch;
    });
  }

  function recordStep(h: HistoryState, prev: Snapshot, key?: string, now = Date.now()): HistoryState {
    if (h.batch) {
      if (h.batch.mutated) return h;
      return { ...h, past: pushLimited(h.past, h.batch.snapshot), future: [], batch: { ...h.batch, mutated: true }, lastKey: null };
    }
    if (key && key === h.lastKey && now - h.lastAt < COALESCE_MS) {
      return { ...h, lastAt: now, future: [] };
    }
    return { ...h, past: pushLimited(h.past, prev), future: [], lastKey: key ?? null, lastAt: now };
  }

  function nodeById(id: string): FlowNode | undefined {
    return get().nodes.find((n) => n.id === id);
  }

  return {
    canvasId: null,
    title: "",
    version: 1,
    nodes: [],
    edges: [],
    viewport: DEFAULT_VIEWPORT,
    grid: true,
    selection: { nodeIds: [], edgeIds: [] },
    dirty: false,
    changeSeq: 0,
    saveState: "saved",
    lastSavedAt: null,
    history: emptyHistory(),
    canUndo: false,
    canRedo: false,

    // -----------------------------------------------------------------------
    // lifecycle
    // -----------------------------------------------------------------------

    load: ({ id, title, version, data }) => {
      const { nodes, edges } = toFlow(data);
      set({
        canvasId: id,
        title,
        version,
        nodes,
        edges,
        viewport: data.craftcanvas?.viewport ?? DEFAULT_VIEWPORT,
        grid: data.craftcanvas?.grid ?? true,
        selection: { nodeIds: [], edgeIds: [] },
        dirty: false,
        changeSeq: 0,
        saveState: "saved",
        lastSavedAt: null,
        history: emptyHistory(),
        canUndo: false,
        canRedo: false,
      });
    },

    replaceFromServer: (detail) => {
      const { nodes, edges } = toFlow(detail.data);
      set((s) => ({
        title: detail.title,
        version: detail.version,
        nodes,
        edges,
        grid: detail.data.craftcanvas?.grid ?? s.grid,
        selection: { nodeIds: [], edgeIds: [] },
        dirty: false,
        history: emptyHistory(),
        canUndo: false,
        canRedo: false,
      }));
    },

    setTitle: (title) => set({ title }),

    getCanvasData: () => {
      const s = get();
      return fromFlow(s.nodes, s.edges, { viewport: s.viewport, grid: s.grid });
    },

    // -----------------------------------------------------------------------
    // React Flow change handlers
    // -----------------------------------------------------------------------

    onNodesChange: (changes) => {
      const s = get();
      let userChange = false;
      let beginsBatch = false;
      let endsBatch = false;
      for (const c of changes) {
        switch (c.type) {
          case "position":
            if (c.position || c.positionAbsolute) userChange = true;
            if (c.dragging === true) beginsBatch = true;
            if (c.dragging === false) endsBatch = true;
            break;
          case "dimensions":
            if (c.setAttributes) userChange = true;
            if (c.resizing === true) beginsBatch = true;
            if (c.resizing === false) endsBatch = true;
            break;
          case "remove":
          case "add":
          case "replace":
            userChange = true;
            break;
          case "select":
            break;
        }
      }
      if (beginsBatch && !s.history.batch) get().beginBatch();
      let nodes = rfApplyNodeChanges(changes, s.nodes);
      // Resizing a group from its top or left edge moves the group's origin;
      // keep the children where they are by shifting them the other way.
      for (const c of changes) {
        if (c.type !== "position" || c.dragging !== undefined || !c.position) continue;
        const before = s.nodes.find((n) => n.id === c.id);
        if (!before || before.type !== "group") continue;
        const dx = c.position.x - before.position.x;
        const dy = c.position.y - before.position.y;
        if (dx === 0 && dy === 0) continue;
        nodes = nodes.map((n) => (n.parentId === c.id ? ({ ...n, position: { x: n.position.x - dx, y: n.position.y - dy } } as FlowNode) : n));
      }
      if (userChange) {
        const removed = changes.some((c) => c.type === "remove");
        const positionOnly = changes.every((c) => c.type === "position" || c.type === "select");
        let edges = s.edges;
        if (removed) {
          const ids = new Set(nodes.map((n) => n.id));
          edges = s.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
        }
        mutate({ nodes, edges }, positionOnly ? { key: "move" } : {});
      } else {
        mutate({ nodes }, { history: false, dirty: false });
      }
      if (endsBatch) {
        get().endBatch();
        get().reparentNodes();
      }
    },

    onEdgesChange: (changes) => {
      const s = get();
      const userChange = changes.some((c) => c.type !== "select");
      const edges = rfApplyEdgeChanges(changes, s.edges);
      mutate({ edges }, userChange ? {} : { history: false, dirty: false });
    },

    onConnect: (connection) => {
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;
      const s = get();
      if (edgeExists(s.edges, connection.source, connection.target)) return;
      const edge: FlowEdge = decorateEdge({
        id: newId(),
        source: connection.source,
        sourceHandle: connection.sourceHandle ?? "right",
        target: connection.target,
        targetHandle: connection.targetHandle ?? "left",
        type: EDGE_TYPE,
        data: { fromEnd: "none", toEnd: "arrow" },
      });
      mutate({ edges: [...s.edges, edge] });
    },

    // -----------------------------------------------------------------------
    // nodes
    // -----------------------------------------------------------------------

    addTextNode: (position, text = "") => {
      const id = newId();
      const s = get();
      const size = DEFAULT_SIZES.text;
      const node = nodeToFlow({
        id,
        type: "text",
        x: s.grid ? snapToGrid(position.x, GRID_SIZE) : position.x,
        y: s.grid ? snapToGrid(position.y, GRID_SIZE) : position.y,
        width: size.width,
        height: size.height,
        text,
      });
      node.selected = true;
      const nodes = attachParents([...withAbsolutePositions(s.nodes).map((n) => ({ ...n, selected: false })), node]);
      mutate({ nodes, edges: s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)) });
      return id;
    },

    addGroupNode: (rect, label = "Group") => {
      const id = newId();
      const s = get();
      const node = nodeToFlow({
        id,
        type: "group",
        x: rect.x,
        y: rect.y,
        width: Math.max(rect.width, 120),
        height: Math.max(rect.height, 80),
        label,
      });
      node.selected = true;
      const nodes = attachParents([...withAbsolutePositions(s.nodes).map((n) => ({ ...n, selected: false })), node]);
      mutate({ nodes, edges: s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)) });
      return id;
    },

    addFileNode: (ext, position) => {
      const size = DEFAULT_SIZES.file;
      const folder = ext.folderPath ? ext.folderPath.replace(/^\/+|\/+$/g, "") : "";
      const safeTitle = (ext.title || "Untitled").replace(/[\\/:*?"<>|]/g, "-");
      const file = `craft/${folder ? `${folder}/` : ""}${safeTitle}.md`;
      return get().addCanvasNode({
        id: newId(),
        type: "file",
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        file,
        craftcanvas: { ...ext },
      });
    },

    addCanvasNode: (canvasNode) => {
      const s = get();
      const node = nodeToFlow(canvasNode);
      node.selected = true;
      const nodes = attachParents([...withAbsolutePositions(s.nodes).map((n) => ({ ...n, selected: false })), node]);
      mutate({ nodes, edges: s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)) });
      return node.id;
    },

    setNodeText: (id, text) => {
      const node = nodeById(id);
      if (!node || node.type !== "text") return;
      if ((node.data as TextNodeData).text === text) return;
      get().updateNodeData(id, { text }, { key: `text:${id}` });
    },

    setNodeSize: (id, size, manual = false) => {
      const s = get();
      const node = s.nodes.find((n) => n.id === id);
      if (!node) return;
      const nodes = s.nodes.map((n) => {
        if (n.id !== id) return n;
        const next = { ...n, width: size.width } as FlowNode;
        if (size.height !== undefined) next.height = size.height;
        if (manual && n.type === "text") next.data = { ...(n.data as TextNodeData), manualSize: true } as TextNodeData;
        return next;
      });
      mutate({ nodes }, { key: `size:${id}` });
    },

    setGroupLabel: (id, label) => {
      const node = nodeById(id);
      if (!node || node.type !== "group") return;
      if ((node.data as GroupNodeData).label === label) return;
      get().updateNodeData(id, { label }, { key: `label:${id}` });
    },

    updateNodeData: (id, patch, options) => {
      const s = get();
      if (!s.nodes.some((n) => n.id === id)) return;
      const nodes = s.nodes.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, ...patch } } as FlowNode) : n));
      mutate({ nodes }, options);
    },

    removeNodes: (ids) => {
      if (ids.length === 0) return;
      const s = get();
      const removed = new Set(ids);
      const remaining = withAbsolutePositions(s.nodes).filter((n) => !removed.has(n.id));
      const nodes = attachParents(remaining);
      const edges = s.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target));
      mutate({ nodes, edges });
    },

    removeSelected: () => {
      const s = get();
      const nodeIds = s.selection.nodeIds;
      const edgeIds = new Set(s.selection.edgeIds);
      if (nodeIds.length === 0 && edgeIds.size === 0) return;
      if (nodeIds.length > 0) {
        const removed = new Set(nodeIds);
        const nodes = attachParents(withAbsolutePositions(s.nodes).filter((n) => !removed.has(n.id)));
        const edges = s.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target) && !edgeIds.has(e.id));
        mutate({ nodes, edges });
      } else {
        mutate({ edges: s.edges.filter((e) => !edgeIds.has(e.id)) });
      }
    },

    setNodesColor: (ids, color) => {
      if (ids.length === 0) return;
      const set_ = new Set(ids);
      const s = get();
      const nodes = s.nodes.map((n) => {
        if (!set_.has(n.id)) return n;
        const data = { ...n.data } as Record<string, unknown>;
        if (color) data.color = color;
        else delete data.color;
        return { ...n, data } as FlowNode;
      });
      mutate({ nodes });
    },

    setSelectionColor: (color) => {
      const s = get();
      if (s.selection.nodeIds.length > 0) get().setNodesColor(s.selection.nodeIds, color);
      if (s.selection.edgeIds.length > 0) get().setEdgesColor(s.selection.edgeIds, color);
    },

    wrapSelectionInGroup: () => {
      const s = get();
      const ids = new Set(s.selection.nodeIds);
      if (ids.size === 0) return null;
      const rects = absoluteRects(s.nodes);
      const bounds = unionRect([...ids].map((id) => rects.get(id)!).filter(Boolean));
      if (!bounds) return null;
      const rect = padRect(bounds, 24);
      // Room for the label above the content.
      rect.y -= 16;
      rect.height += 16;
      return get().addGroupNode(rect);
    },

    duplicateNodes: (ids, options = {}) => {
      const offset = options.offset ?? 24;
      const selectClones = options.selectClones ?? true;
      const s = get();
      const wanted = new Set(ids);
      if (wanted.size === 0) return [];
      const abs = withAbsolutePositions(s.nodes);
      const idMap = new Map<string, string>();
      for (const id of wanted) idMap.set(id, newId());
      const clones: FlowNode[] = abs
        .filter((n) => wanted.has(n.id))
        .map((n) => {
          const clone = {
            ...n,
            id: idMap.get(n.id)!,
            position: { x: n.position.x + offset, y: n.position.y + offset },
            data: structuredClone(n.data),
            selected: selectClones,
          } as FlowNode;
          delete clone.measured;
          return clone;
        });
      const originals = abs.map((n) => (selectClones && n.selected ? { ...n, selected: false } : n));
      const clonedEdges: FlowEdge[] = s.edges
        .filter((e) => wanted.has(e.source) && wanted.has(e.target))
        .map((e) => ({
          ...e,
          id: newId(),
          source: idMap.get(e.source)!,
          target: idMap.get(e.target)!,
          data: e.data ? { ...e.data } : e.data,
          selected: false,
        }));
      const nodes = attachParents([...originals, ...clones]);
      const edges = [...s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)), ...clonedEdges];
      mutate({ nodes, edges });
      return [...idMap.values()];
    },

    duplicateSelected: () => get().duplicateNodes(get().selection.nodeIds),

    nudgeSelected: (dx, dy) => {
      const s = get();
      const ids = new Set(s.selection.nodeIds);
      if (ids.size === 0) return;
      // Children of a selected group move with it; skip them to avoid double moves.
      const nodes = s.nodes.map((n) => {
        if (!ids.has(n.id)) return n;
        if (n.parentId && ids.has(n.parentId)) return n;
        return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } as FlowNode;
      });
      mutate({ nodes }, { key: "nudge" });
    },

    reparentNodes: () => {
      const s = get();
      const nodes = attachParents(s.nodes);
      const changed =
        nodes.length !== s.nodes.length ||
        nodes.some((n, i) => {
          const o = s.nodes[i];
          return o.id !== n.id || o.parentId !== n.parentId || o.position.x !== n.position.x || o.position.y !== n.position.y;
        });
      if (changed) mutate({ nodes }, { history: false, dirty: true });
    },

    // -----------------------------------------------------------------------
    // edges
    // -----------------------------------------------------------------------

    addEdge: (fromNode, toNode, sides) => {
      const s = get();
      if (fromNode === toNode) return null;
      if (edgeExists(s.edges, fromNode, toNode)) return null;
      const rects = absoluteRects(s.nodes);
      const from = rects.get(fromNode);
      const to = rects.get(toNode);
      if (!from || !to) return null;
      const picked = sides ?? pickSides(from, to);
      const flow = edgeToFlow(
        { id: newId(), fromNode, toNode, fromSide: picked.fromSide, toSide: picked.toSide, toEnd: "arrow" },
        rects,
      );
      flow.selected = true;
      const nodes = s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)) as FlowNode[];
      const edges = [...s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)), flow];
      mutate({ nodes, edges });
      return flow.id;
    },

    connectSelected: () => {
      const s = get();
      if (s.selection.nodeIds.length !== 2) return null;
      const ordered = s.nodes.filter((n) => s.selection.nodeIds.includes(n.id)).map((n) => n.id);
      return get().addEdge(ordered[0], ordered[1]);
    },

    updateEdgeData: (id, patch, options) => {
      const s = get();
      if (!s.edges.some((e) => e.id === id)) return;
      const edges = s.edges.map((e) =>
        e.id === id ? decorateEdge({ ...e, data: { ...(e.data ?? { fromEnd: "none", toEnd: "arrow" }), ...patch } }) : e,
      );
      mutate({ edges }, options);
    },

    setEdgeLabel: (id, label) => {
      const edge = get().edges.find((e) => e.id === id);
      if (!edge) return;
      if ((edge.data?.label ?? "") === label) return;
      get().updateEdgeData(id, { label }, { key: `edge-label:${id}` });
    },

    setEdgeDirection: (id, direction) => {
      const ends: Record<EdgeDirection, { fromEnd: EdgeEnd; toEnd: EdgeEnd }> = {
        oneway: { fromEnd: "none", toEnd: "arrow" },
        both: { fromEnd: "arrow", toEnd: "arrow" },
        none: { fromEnd: "none", toEnd: "none" },
      };
      get().updateEdgeData(id, ends[direction]);
    },

    setEdgesColor: (ids, color) => {
      if (ids.length === 0) return;
      const wanted = new Set(ids);
      const s = get();
      const edges = s.edges.map((e) => {
        if (!wanted.has(e.id)) return e;
        const data: EdgeData = { ...(e.data ?? { fromEnd: "none", toEnd: "arrow" }) };
        if (color) data.color = color;
        else delete data.color;
        return decorateEdge({ ...e, data });
      });
      mutate({ edges });
    },

    removeEdges: (ids) => {
      if (ids.length === 0) return;
      const wanted = new Set(ids);
      mutate({ edges: get().edges.filter((e) => !wanted.has(e.id)) });
    },

    // -----------------------------------------------------------------------
    // selection
    // -----------------------------------------------------------------------

    selectAll: () => {
      const s = get();
      mutate(
        { nodes: s.nodes.map((n) => ({ ...n, selected: true })) as FlowNode[], edges: s.edges.map((e) => ({ ...e, selected: true })) },
        { history: false, dirty: false },
      );
    },

    clearSelection: () => {
      const s = get();
      if (s.selection.nodeIds.length === 0 && s.selection.edgeIds.length === 0) return;
      mutate(
        {
          nodes: s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)) as FlowNode[],
          edges: s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
        },
        { history: false, dirty: false },
      );
    },

    select: (nodeIds, edgeIds = [], additive = false) => {
      const s = get();
      const n = new Set(nodeIds);
      const e = new Set(edgeIds);
      mutate(
        {
          nodes: s.nodes.map((node) => ({ ...node, selected: n.has(node.id) || (additive && !!node.selected) })) as FlowNode[],
          edges: s.edges.map((edge) => ({ ...edge, selected: e.has(edge.id) || (additive && !!edge.selected) })),
        },
        { history: false, dirty: false },
      );
    },

    getSelectedNodes: () => get().nodes.filter((n) => n.selected),

    // -----------------------------------------------------------------------
    // viewport and settings
    // -----------------------------------------------------------------------

    setViewport: (viewport) => {
      const s = get();
      if (s.viewport.x === viewport.x && s.viewport.y === viewport.y && s.viewport.zoom === viewport.zoom) return;
      set({ viewport, dirty: true, changeSeq: s.changeSeq + 1 });
    },

    setGrid: (grid) => {
      const s = get();
      if (s.grid === grid) return;
      set({ grid, dirty: true, changeSeq: s.changeSeq + 1 });
    },

    // -----------------------------------------------------------------------
    // history
    // -----------------------------------------------------------------------

    undo: () => {
      const s = get();
      const past = s.history.batch ? s.history.past : s.history.past;
      if (past.length === 0) return;
      const snapshot = past[past.length - 1];
      const current: Snapshot = { nodes: s.nodes, edges: s.edges };
      const history: HistoryState = {
        past: past.slice(0, -1),
        future: pushLimited(s.history.future, current),
        batch: null,
        lastKey: null,
        lastAt: 0,
      };
      set({
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        selection: deriveSelection(snapshot.nodes, snapshot.edges, s.selection),
        history,
        canUndo: history.past.length > 0,
        canRedo: true,
        dirty: true,
        changeSeq: s.changeSeq + 1,
      });
    },

    redo: () => {
      const s = get();
      const future = s.history.future;
      if (future.length === 0) return;
      const snapshot = future[future.length - 1];
      const current: Snapshot = { nodes: s.nodes, edges: s.edges };
      const history: HistoryState = {
        past: pushLimited(s.history.past, current),
        future: future.slice(0, -1),
        batch: null,
        lastKey: null,
        lastAt: 0,
      };
      set({
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        selection: deriveSelection(snapshot.nodes, snapshot.edges, s.selection),
        history,
        canUndo: true,
        canRedo: history.future.length > 0,
        dirty: true,
        changeSeq: s.changeSeq + 1,
      });
    },

    beginBatch: () => {
      const s = get();
      if (s.history.batch) return;
      set({ history: { ...s.history, batch: { snapshot: { nodes: s.nodes, edges: s.edges }, mutated: false }, lastKey: null } });
    },

    endBatch: () => {
      const s = get();
      if (!s.history.batch) return;
      set({ history: { ...s.history, batch: null, lastKey: null } });
    },

    breakCoalescing: () => {
      const s = get();
      if (s.history.lastKey === null) return;
      set({ history: { ...s.history, lastKey: null } });
    },

    // -----------------------------------------------------------------------
    // save pipeline
    // -----------------------------------------------------------------------

    setSaveState: (saveState) => set({ saveState }),

    markSaved: (version, seq) => {
      const s = get();
      set({
        version,
        saveState: "saved",
        lastSavedAt: Date.now(),
        dirty: s.changeSeq !== seq,
      });
    },
  };
});

/** Ids of Craft documents currently on the canvas (for the notes panel dot). */
export function selectDocIdsOnCanvas(state: Pick<CanvasStore, "nodes">): Set<string> {
  const ids = new Set<string>();
  for (const n of state.nodes) {
    if (n.type === "file") ids.add((n.data as FileNodeData).craftcanvas.craftDocId);
  }
  return ids;
}

/** Count of cards per Craft document id (for the "2" badge). */
export function selectDocCounts(state: Pick<CanvasStore, "nodes">): Map<string, number> {
  const counts = new Map<string, number>();
  for (const n of state.nodes) {
    if (n.type !== "file") continue;
    const id = (n.data as FileNodeData).craftcanvas.craftDocId;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
