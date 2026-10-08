/**
 * Shared Craft types. Other work packages import from here; extend, do not rewrite.
 *
 * These are OUR normalised shapes. Raw Craft Connect API responses are mapped
 * into them in `normalise.ts` and nowhere else.
 */

export type CraftFolder = {
  id: string;
  name: string;
  parentId?: string;
  /** "/" separated path of folder names from the root, e.g. "Projects/Research". */
  path: string;
};

export type CraftDocument = {
  id: string;
  title: string;
  folderId?: string;
  /** Path of the containing folder, "" when at the root or unknown. */
  folderPath: string;
  /** ISO 8601 string, when Craft reports it. */
  updatedAt?: string;
  /** Web share link, when Craft reports it. */
  webUrl?: string;
};

export type CraftConnectionStatus = "ok" | "unauthorized" | "error";

/** Row of `craft_documents` trimmed for the browser. */
export type IndexedDocument = {
  craftDocId: string;
  title: string;
  folderId: string | null;
  folderPath: string;
  updatedAt: string | null;
  indexedAt: string | null;
  missing: boolean;
};

/** `GET /api/craft/preview/:docId` (shared contract, see IMPLEMENTATION_PLAN.md). */
export type PreviewResponse = {
  craftDocId: string;
  title: string;
  folderPath: string;
  preview: string;
  updatedAt: string | null;
  indexedAt: string;
  missing: boolean;
  webUrl?: string;
};

/** `GET /api/craft/status`. */
export type CraftStatusResponse = {
  connected: boolean;
  status: CraftConnectionStatus | null;
  lastFullSync: string | null;
  label: string | null;
  /** Host part of the connection URL only, never the full URL. */
  host: string | null;
  documentCount: number;
  /** True while a full refresh is running in this server process. */
  syncing: boolean;
  /** Id of the `craft_connections` row (stored on file nodes). Absent when not connected. */
  connectionId?: string | null;
  /** Craft space id when the index found one (used for `craftdocs://` deep links). */
  spaceId?: string | null;
};

/** Rows returned by `GET /api/craft/search`. */
export type SearchResult = {
  id: string;
  title: string;
  folderPath: string;
  updatedAt: string | null;
  /** Where the row came from; "local" rows are listed first. */
  source: "local" | "craft";
  missing?: boolean;
};

export type SearchResponse = {
  query: string;
  documents: SearchResult[];
  counts: { local: number; craft: number };
  /** Set when the Craft search failed and only local rows are returned. */
  craftError?: string;
};

/** Payload set on `dataTransfer` when a row is dragged from the notes panel. */
export type CraftDocDragPayload = { craftDocId: string; title: string; folderPath: string };

export const CRAFT_DOC_DRAG_TYPE = "application/x-craftcanvas-doc";
