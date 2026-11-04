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
};

export type SyncStatus = {
  lastSyncAt: string | null;
  noteCount: number;
  linkCount: number;
  mode: CraftMode;
  running: boolean;
};

export type ApiError = { error: string; message?: string };
