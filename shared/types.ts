// Shared API types. Imported by the Worker (worker/) and the SPA (src/). Keep in sync with docs/API.md.

export type NoteSummary = {
  id: string;
  title: string;
  folderId: string | null;
  folderName: string | null;
  preview: string;
  createdAt: string | null;
  modifiedAt: string | null;
  deepLinkApp: string;
  deepLinkWeb: string;
  linkCount: number;
  backlinkCount: number;
};

export type Link = {
  sourceNoteId: string;
  targetNoteId: string | null;
  targetBlockId: string;
  label: string;
  outOfScope: boolean;
};

export type Note = NoteSummary & {
  markdown: string;
  outgoing: Link[];
  incoming: Link[];
  boards: { boardId: string; boardName: string; cardId: string }[];
};

export type Folder = { id: string; name: string; noteCount: number };

export type Viewport = { x: number; y: number; zoom: number };

export type Board = {
  id: string;
  name: string;
  viewport: Viewport;
  cardCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Card = {
  id: string;
  boardId: string;
  noteId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  folded: boolean;
  sectionId: string | null;
  z: number;
  /** Preset id ("1".."6") or hex; null = none. */
  color: string | null;
};

export type Section = {
  id: string;
  boardId: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string | null;
};

export type ConnectionKind = "manual" | "suggested" | "accepted";

export type Connection = {
  id: string;
  boardId: string;
  sourceNoteId: string;
  targetNoteId: string;
  kind: ConnectionKind;
  label: string | null;
};

export type BoardDetail = Board & {
  cards: Card[];
  sections: Section[];
  connections: Connection[];
  notes: NoteSummary[];
};

export type CraftMode = "fixture" | "craft";

export type SyncResult = {
  done: boolean;
  cursor: string | null;
  imported: number;
  total: number | null;
  mode: CraftMode;
  /** Documents skipped so far because Craft returned 403/404/410 for them. */
  skipped: number;
  /** True when some folder could not be listed; notes missing from the listing are kept, not marked deleted. */
  partial: boolean;
};

export type SyncStatus = {
  lastSyncAt: string | null;
  noteCount: number;
  linkCount: number;
  mode: CraftMode;
  running: boolean;
};

export type ApiError = { error: string; message?: string };

// ---------- Phase 2 ----------

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

export type ArrowEndKind = "card" | "object";
export type ArrowEnd = { kind: ArrowEndKind; id: string };
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

export type AssetKind = "image" | "pdf";

export type Asset = {
  id: string;
  kind: AssetKind;
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

export type YouTubeMeta = {
  videoId: string;
  url: string;
  embedUrl: string;
  title: string | null;
  author: string | null;
  thumbnailUrl: string | null;
};

export type SearchKind = "note" | "object" | "pdf_page";

export type SearchResult = {
  id: string;
  kind: SearchKind;
  objectKind?: ObjectKind;
  title: string;
  snippet: string;
  boardIds: string[];
  page?: number;
  assetId?: string;
  score: number;
};

export type BoardDetailV2 = BoardDetail & { objects: CanvasObject[]; arrows: Arrow[] };
