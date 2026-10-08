/**
 * Conversion between the JSON Canvas document (`CanvasData`) and React Flow
 * node / edge objects. Round trippable: `fromFlow(toFlow(data))` equals the
 * normalised `data` (see `normaliseCanvasData`).
 *
 * Groups become React Flow parent containers: a node whose rectangle sits fully
 * inside a group gets `parentId` set to the smallest such group, so it moves
 * with the group. Group positions stay absolute in the JSON Canvas document;
 * child positions are converted to parent relative coordinates for React Flow
 * and back again.
 */
import { MarkerType, type Edge, type Node } from "@xyflow/react";

import { resolveColor, NEUTRAL_STROKE } from "./colors";
import { pickSides, rectArea, rectContains, type Rect } from "./geometry";
import {
  DEFAULT_SIZES,
  type CanvasData,
  type CanvasEdge,
  type CanvasExtension,
  type CanvasNode,
  type EdgeEnd,
  type FileNodeExtension,
  type NodeSide,
} from "./types";

// ---------------------------------------------------------------------------
// React Flow shapes
// ---------------------------------------------------------------------------

export type TextNodeData = { text: string; color?: string; manualSize?: boolean };
export type FileNodeData = { file: string; subpath?: string; color?: string; craftcanvas: FileNodeExtension };
export type LinkNodeData = { url: string; color?: string };
export type GroupNodeData = {
  label?: string;
  color?: string;
  background?: string;
  backgroundStyle?: "cover" | "ratio" | "repeat";
};

export type TextFlowNode = Node<TextNodeData, "text">;
export type FileFlowNode = Node<FileNodeData, "file">;
export type LinkFlowNode = Node<LinkNodeData, "link">;
export type GroupFlowNode = Node<GroupNodeData, "group">;
export type FlowNode = TextFlowNode | FileFlowNode | LinkFlowNode | GroupFlowNode;
export type FlowNodeType = NonNullable<FlowNode["type"]>;

export type EdgeData = { label?: string; color?: string; fromEnd: EdgeEnd; toEnd: EdgeEnd };
export type FlowEdge = Edge<EdgeData, "canvas">;

export const EDGE_TYPE = "canvas" as const;

/** z-index used for groups (bottom) and regular nodes (above groups). */
export const GROUP_Z = 0;
export const NODE_Z = 1;

// ---------------------------------------------------------------------------
// Parents
// ---------------------------------------------------------------------------

type AbsoluteNode = { id: string; type: FlowNodeType; rect: Rect };

/**
 * For every node, returns the id of the smallest group that fully contains it
 * (or `undefined`). A group can only be parented by a strictly larger group,
 * which rules out cycles.
 */
export function assignParents(nodes: AbsoluteNode[]): Map<string, string | undefined> {
  const groups = nodes.filter((n) => n.type === "group");
  const result = new Map<string, string | undefined>();
  for (const node of nodes) {
    let best: AbsoluteNode | undefined;
    for (const g of groups) {
      if (g.id === node.id) continue;
      if (node.type === "group" && rectArea(g.rect) <= rectArea(node.rect)) continue;
      if (!rectContains(g.rect, node.rect)) continue;
      if (!best || rectArea(g.rect) < rectArea(best.rect)) best = g;
    }
    result.set(node.id, best?.id);
  }
  return result;
}

function nodeSize(node: FlowNode): { width: number; height: number } {
  const type = node.type ?? "text";
  const defaults = DEFAULT_SIZES[type];
  // Auto sized text cards carry their stored height in `initialHeight` until the DOM measures them.
  return {
    width: node.width ?? node.measured?.width ?? node.initialWidth ?? defaults.width,
    height: node.height ?? node.measured?.height ?? node.initialHeight ?? defaults.height,
  };
}

/** Absolute (canvas) rectangles for React Flow nodes, resolving parent chains. */
export function absoluteRects(nodes: FlowNode[]): Map<string, Rect> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cache = new Map<string, Rect>();
  const resolve = (node: FlowNode, depth = 0): Rect => {
    const cached = cache.get(node.id);
    if (cached) return cached;
    const size = nodeSize(node);
    let x = node.position.x;
    let y = node.position.y;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && depth < 64) {
      const p = resolve(parent, depth + 1);
      x += p.x;
      y += p.y;
    }
    const rect = { x, y, ...size };
    cache.set(node.id, rect);
    return rect;
  };
  for (const n of nodes) resolve(n);
  return cache;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

function marker(color: string | undefined) {
  return {
    type: MarkerType.ArrowClosed,
    color: resolveColor(color) ?? NEUTRAL_STROKE,
    width: 18,
    height: 18,
  };
}

/** Applies presentation (markers, handles) derived from `data` to a flow edge. */
export function decorateEdge(edge: FlowEdge): FlowEdge {
  const data: EdgeData = edge.data ?? { fromEnd: "none", toEnd: "arrow" };
  const next: FlowEdge = {
    ...edge,
    type: EDGE_TYPE,
    data,
    markerStart: data.fromEnd === "arrow" ? marker(data.color) : undefined,
    markerEnd: data.toEnd === "arrow" ? marker(data.color) : undefined,
  };
  if (next.markerStart === undefined) delete next.markerStart;
  if (next.markerEnd === undefined) delete next.markerEnd;
  return next;
}

export function edgeToFlow(edge: CanvasEdge, rects: Map<string, Rect>): FlowEdge {
  let fromSide = edge.fromSide;
  let toSide = edge.toSide;
  if (!fromSide || !toSide) {
    const from = rects.get(edge.fromNode);
    const to = rects.get(edge.toNode);
    const picked = from && to ? pickSides(from, to) : { fromSide: "right" as const, toSide: "left" as const };
    fromSide = fromSide ?? picked.fromSide;
    toSide = toSide ?? picked.toSide;
  }
  const data: EdgeData = {
    fromEnd: edge.fromEnd ?? "none",
    toEnd: edge.toEnd ?? "arrow",
  };
  if (edge.label !== undefined) data.label = edge.label;
  if (edge.color !== undefined) data.color = edge.color;
  return decorateEdge({
    id: edge.id,
    source: edge.fromNode,
    sourceHandle: fromSide,
    target: edge.toNode,
    targetHandle: toSide,
    type: EDGE_TYPE,
    data,
  });
}

export function edgeFromFlow(edge: FlowEdge): CanvasEdge {
  const out: CanvasEdge = { id: edge.id, fromNode: edge.source, toNode: edge.target };
  if (edge.sourceHandle) out.fromSide = edge.sourceHandle as NodeSide;
  if (edge.targetHandle) out.toSide = edge.targetHandle as NodeSide;
  const fromEnd = edge.data?.fromEnd ?? "none";
  const toEnd = edge.data?.toEnd ?? "arrow";
  if (fromEnd !== "none") out.fromEnd = fromEnd;
  if (toEnd !== "arrow") out.toEnd = toEnd;
  if (edge.data?.color) out.color = edge.data.color;
  if (edge.data?.label !== undefined && edge.data.label !== "") out.label = edge.data.label;
  return out;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

function nodeData(node: CanvasNode): FlowNode["data"] {
  switch (node.type) {
    case "text": {
      const d: TextNodeData = { text: node.text };
      if (node.color !== undefined) d.color = node.color;
      if (node.craftcanvas?.manualSize) d.manualSize = true;
      return d;
    }
    case "file": {
      const d: FileNodeData = { file: node.file, craftcanvas: { ...node.craftcanvas } };
      if (node.subpath !== undefined) d.subpath = node.subpath;
      if (node.color !== undefined) d.color = node.color;
      return d;
    }
    case "link": {
      const d: LinkNodeData = { url: node.url };
      if (node.color !== undefined) d.color = node.color;
      return d;
    }
    case "group": {
      const d: GroupNodeData = {};
      if (node.label !== undefined) d.label = node.label;
      if (node.color !== undefined) d.color = node.color;
      if (node.background !== undefined) d.background = node.background;
      if (node.backgroundStyle !== undefined) d.backgroundStyle = node.backgroundStyle;
      return d;
    }
  }
}

/**
 * Converts a single JSON Canvas node to a React Flow node with an absolute
 * position and no parent. Use `toFlow` for a whole document, or
 * `attachParents` after adding a node to an existing list.
 */
export function nodeToFlow(node: CanvasNode): FlowNode {
  const base = {
    id: node.id,
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    zIndex: node.type === "group" ? GROUP_Z : NODE_Z,
  };
  switch (node.type) {
    case "text": {
      const flow: TextFlowNode = { ...base, type: "text", data: nodeData(node) as TextNodeData };
      // Auto grow: let the DOM decide the height until the user resizes by hand.
      if (!node.craftcanvas?.manualSize) {
        flow.height = undefined;
        flow.initialHeight = node.height;
      }
      return flow;
    }
    case "file":
      return { ...base, type: "file", data: nodeData(node) as FileNodeData };
    case "link":
      return { ...base, type: "link", data: nodeData(node) as LinkNodeData };
    case "group":
      return { ...base, type: "group", data: nodeData(node) as GroupNodeData };
  }
}

/** Converts a React Flow node (with an absolute rect) back to a JSON Canvas node. */
export function nodeFromFlow(node: FlowNode, rect: Rect): CanvasNode {
  const geometry = {
    id: node.id,
    x: round(rect.x),
    y: round(rect.y),
    width: round(rect.width),
    height: round(rect.height),
  };
  switch (node.type) {
    case "text": {
      const out: CanvasNode = { ...geometry, type: "text", text: node.data.text };
      if (node.data.color) out.color = node.data.color;
      if (node.data.manualSize) out.craftcanvas = { manualSize: true };
      return out;
    }
    case "file": {
      const out: CanvasNode = {
        ...geometry,
        type: "file",
        file: node.data.file,
        craftcanvas: { ...node.data.craftcanvas },
      };
      if (node.data.subpath !== undefined) out.subpath = node.data.subpath;
      if (node.data.color) out.color = node.data.color;
      return out;
    }
    case "link": {
      const out: CanvasNode = { ...geometry, type: "link", url: node.data.url };
      if (node.data.color) out.color = node.data.color;
      return out;
    }
    case "group":
    default: {
      const data = node.data as GroupNodeData;
      const out: CanvasNode = { ...geometry, type: "group" };
      if (data.label !== undefined) out.label = data.label;
      if (data.color) out.color = data.color;
      if (data.background !== undefined) out.background = data.background;
      if (data.backgroundStyle !== undefined) out.backgroundStyle = data.backgroundStyle;
      return out;
    }
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * Recomputes `parentId` and parent relative positions for a list of React Flow
 * nodes, based on their absolute rectangles. Groups are ordered first (outer
 * before inner) so they render at the bottom of the z order.
 */
export function attachParents(nodes: FlowNode[]): FlowNode[] {
  const rects = absoluteRects(nodes);
  const parents = assignParents(
    nodes.map((n) => ({ id: n.id, type: (n.type ?? "text") as FlowNodeType, rect: rects.get(n.id)! })),
  );
  const ordered = [
    ...nodes.filter((n) => n.type === "group").sort((a, b) => rectArea(rects.get(b.id)!) - rectArea(rects.get(a.id)!)),
    ...nodes.filter((n) => n.type !== "group"),
  ];
  return ordered.map((n) => {
    const rect = rects.get(n.id)!;
    const parentId = parents.get(n.id);
    const parentRect = parentId ? rects.get(parentId) : undefined;
    const position = parentRect ? { x: rect.x - parentRect.x, y: rect.y - parentRect.y } : { x: rect.x, y: rect.y };
    const next = { ...n, position, zIndex: n.type === "group" ? GROUP_Z : NODE_Z } as FlowNode;
    if (parentId) next.parentId = parentId;
    else delete next.parentId;
    return next;
  });
}

export function toFlow(data: CanvasData): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes = attachParents(data.nodes.map(nodeToFlow));
  const rects = new Map<string, Rect>(data.nodes.map((n) => [n.id, { x: n.x, y: n.y, width: n.width, height: n.height }]));
  const ids = new Set(data.nodes.map((n) => n.id));
  const edges = data.edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode)).map((e) => edgeToFlow(e, rects));
  return { nodes, edges };
}

export function fromFlow(nodes: FlowNode[], edges: FlowEdge[], extension?: CanvasExtension): CanvasData {
  const rects = absoluteRects(nodes);
  const ids = new Set(nodes.map((n) => n.id));
  const out: CanvasData = {
    nodes: nodes.map((n) => nodeFromFlow(n, rects.get(n.id)!)),
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map(edgeFromFlow),
  };
  if (extension) out.craftcanvas = { ...extension };
  return out;
}

/**
 * The canonical form `fromFlow(toFlow(data))` produces: groups first (largest
 * first), default edge ends omitted, numbers rounded to two decimals.
 */
export function normaliseCanvasData(data: CanvasData): CanvasData {
  const { nodes, edges } = toFlow(data);
  return fromFlow(nodes, edges, data.craftcanvas);
}
