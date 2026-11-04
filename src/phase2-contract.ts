// Temporary contract scaffold from docs/API.md. Replace with shared imports when main lands.
import type { BoardDetail } from "../shared/types";
export type ObjectKind = "text" | "card" | "image" | "pdf" | "youtube";
export type CanvasObject = {
  id: string;
  boardId: string;
  kind: ObjectKind;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  sectionId: string | null;
  color: string | null;
  title: string | null;
  text: string | null;
  url: string | null;
  assetId: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
export type ArrowEnd = { kind: "card" | "object"; id: string };
export type ArrowType = "parent_child" | "related" | "custom";
export type Arrow = {
  id: string;
  boardId: string;
  source: ArrowEnd;
  target: ArrowEnd;
  type: ArrowType;
  label: string | null;
  color: string | null;
  sourceHandle: string | null;
  targetHandle: string | null;
  createdAt: string;
};
export type Asset = {
  id: string;
  kind: "image" | "pdf";
  filename: string;
  contentType: string;
  size: number;
  url: string;
  width: number | null;
  height: number | null;
  pageCount: number | null;
  textStatus: "none" | "pending" | "done";
  createdAt: string;
};
export type SearchResult = {
  id: string;
  kind: "note" | "object" | "pdf_page";
  objectKind?: ObjectKind;
  title: string;
  snippet: string;
  boardIds: string[];
  page?: number;
  assetId?: string;
  score: number;
};
export type CanvasBoard = BoardDetail & {
  objects: CanvasObject[];
  arrows: Arrow[];
};
