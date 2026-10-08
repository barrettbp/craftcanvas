/**
 * Canvas data types.
 *
 * `CanvasData` follows JSON Canvas 1.0 (https://jsoncanvas.org/spec/1.0/).
 * CraftCanvas extras live under `craftcanvas` keys so other tools ignore them
 * (spec section 9, plan "Shared contracts").
 *
 * This file is a shared contract: later work packages extend it, they do not
 * rewrite it.
 */

/** JSON Canvas preset colour id ("1" to "6") or a hex colour ("#rrggbb"). */
export type CanvasColor = string;

export type NodeSide = "top" | "right" | "bottom" | "left";
export type EdgeEnd = "none" | "arrow";

export const NODE_SIDES: readonly NodeSide[] = ["top", "right", "bottom", "left"];

type BaseCanvasNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
};

/** Extension block on text nodes. */
export type TextNodeExtension = {
  /** True once the user resized the card by hand; auto grow is then off. */
  manualSize?: boolean;
};

export type TextCanvasNode = BaseCanvasNode & {
  type: "text";
  /** Markdown. */
  text: string;
  craftcanvas?: TextNodeExtension;
};

/** Extension block on file (note card) nodes. See plan "Shared contracts". */
export type FileNodeExtension = {
  craftDocId: string;
  connectionId: string;
  title: string;
  folderPath?: string;
  preview?: string;
  /** ISO timestamp of the last index refresh for this card. */
  indexedAt?: string;
  missing?: boolean;
  /** ISO timestamp from Craft. */
  updatedAt?: string;
  webUrl?: string;
};

export type FileCanvasNode = BaseCanvasNode & {
  type: "file";
  /** Best effort path so Obsidian shows something sensible, e.g. "craft/Folder/Doc.md". */
  file: string;
  subpath?: string;
  craftcanvas: FileNodeExtension;
};

export type LinkCanvasNode = BaseCanvasNode & {
  type: "link";
  url: string;
};

export type GroupCanvasNode = BaseCanvasNode & {
  type: "group";
  label?: string;
  background?: string;
  backgroundStyle?: "cover" | "ratio" | "repeat";
};

export type CanvasNode = TextCanvasNode | FileCanvasNode | LinkCanvasNode | GroupCanvasNode;
export type CanvasNodeType = CanvasNode["type"];

export type CanvasEdge = {
  id: string;
  fromNode: string;
  fromSide?: NodeSide;
  fromEnd?: EdgeEnd;
  toNode: string;
  toSide?: NodeSide;
  toEnd?: EdgeEnd;
  color?: CanvasColor;
  label?: string;
};

export type CanvasViewport = { x: number; y: number; zoom: number };

/** Top level extension block. */
export type CanvasExtension = {
  viewport?: CanvasViewport;
  /** Snap to the 8px grid. */
  grid?: boolean;
};

export type CanvasData = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  craftcanvas?: CanvasExtension;
};

/** Canvas row as returned by the list and detail API routes (no `data` in the list). */
export type CanvasSummary = {
  id: string;
  title: string;
  version: number;
  thumbnail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CanvasDetail = CanvasSummary & { data: CanvasData };

/** Default sizes (spec 8.2). */
export const DEFAULT_SIZES = {
  text: { width: 240, height: 120 },
  file: { width: 320, height: 200 },
  link: { width: 320, height: 120 },
  group: { width: 480, height: 320 },
} as const;

export const MIN_SIZES = {
  text: { width: 120, height: 48 },
  file: { width: 160, height: 80 },
  link: { width: 160, height: 80 },
  group: { width: 120, height: 80 },
} as const;

export const GRID_SIZE = 8;
