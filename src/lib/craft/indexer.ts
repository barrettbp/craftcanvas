/**
 * Document indexer. Keeps `craft_documents` in sync with what the connection
 * can see: title, folder, updated time and a ~600 character preview.
 *
 * - `fullRefresh` walks folders and documents, fetches previews four at a
 *   time, upserts rows, flags documents that disappeared as `missing`, and
 *   stamps `last_full_sync`. Rate limited to once per minute per user.
 * - `startFullRefresh` does the same in the background (used by connect and
 *   by the refresh route) and reports `syncing` through `isRefreshInFlight`.
 * - `refreshDocument` updates a single document (preview route, card refresh).
 *
 * The pure parts (preview trimming, concurrency, `needsPreview`, staleness)
 * live in `preview.ts` / `concurrency.ts` and are unit tested.
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import { craftConnections, craftDocuments, getDb, type CraftDocument as CraftDocumentRow } from "@/db";
import { log } from "@/lib/log";

import { mapWithConcurrency } from "./concurrency";
import { getConnectionForUser, markUnauthorized, runWithConnection, type LoadedConnection } from "./connection";
import { CraftNotFoundError, CraftRequestError, CraftUnauthorizedError, RefreshRateLimitedError } from "./errors";
import { needsPreview, titleFromMarkdown, trimPreview } from "./preview";
import type { CraftDocument, PreviewResponse } from "./types";

export const PREVIEW_CONCURRENCY = 4;
export const LISTING_CONCURRENCY = 4;
export const MIN_REFRESH_INTERVAL_MS = 60 * 1000;
export const STALE_AFTER_MS = 15 * 60 * 1000;
const UPSERT_CHUNK = 200;

export type FullRefreshResult = {
  folders: number;
  documents: number;
  previewsFetched: number;
  missing: number;
  errors: number;
  durationMs: number;
};

export type RefreshOptions = {
  /** Skip the once-per-minute rule (used right after connecting). */
  force?: boolean;
  now?: () => Date;
};

/** Seconds until another full refresh is allowed; 0 when allowed now. */
export function refreshRetryAfterSeconds(lastFullSync: Date | null | undefined, now = new Date(), minIntervalMs = MIN_REFRESH_INTERVAL_MS): number {
  if (!lastFullSync) return 0;
  const elapsed = now.getTime() - lastFullSync.getTime();
  if (elapsed >= minIntervalMs) return 0;
  return Math.max(1, Math.ceil((minIntervalMs - elapsed) / 1000));
}

/** True when the index should be refreshed in the background (older than 15 minutes). */
export function isStale(lastFullSync: Date | null | undefined, now = new Date(), staleAfterMs = STALE_AFTER_MS): boolean {
  if (!lastFullSync) return true;
  return now.getTime() - lastFullSync.getTime() > staleAfterMs;
}

// ---------------------------------------------------------------------------
// In-flight tracking (per server process; v1 runs a single instance).

const inFlight = new Map<string, Promise<FullRefreshResult>>();

export function isRefreshInFlight(userId: string): boolean {
  return inFlight.has(userId);
}

function track(userId: string, run: Promise<FullRefreshResult>): Promise<FullRefreshResult> {
  const tracked = run.finally(() => {
    if (inFlight.get(userId) === tracked) inFlight.delete(userId);
  });
  inFlight.set(userId, tracked);
  return tracked;
}

async function prepare(userId: string, opts: RefreshOptions): Promise<LoadedConnection> {
  const loaded = await getConnectionForUser(userId);
  if (!opts.force) {
    const retryAfter = refreshRetryAfterSeconds(loaded.connection.lastFullSync, (opts.now ?? (() => new Date()))());
    if (retryAfter > 0) throw new RefreshRateLimitedError(retryAfter);
  }
  return loaded;
}

/** Runs a full refresh and waits for it. Joins an already running one. */
export async function fullRefresh(userId: string, opts: RefreshOptions = {}): Promise<FullRefreshResult> {
  const running = inFlight.get(userId);
  if (running) return running;
  const loaded = await prepare(userId, opts);
  return track(userId, runFullRefresh(loaded, opts));
}

/** Starts a full refresh without waiting for it. The rate limit check still happens synchronously. */
export async function startFullRefresh(userId: string, opts: RefreshOptions = {}): Promise<{ started: boolean; alreadyRunning: boolean }> {
  if (inFlight.has(userId)) return { started: false, alreadyRunning: true };
  const loaded = await prepare(userId, opts);
  const run = track(userId, runFullRefresh(loaded, opts));
  run.catch((err: unknown) => {
    log.error("craft/indexer background refresh failed", { err });
  });
  return { started: true, alreadyRunning: false };
}

// ---------------------------------------------------------------------------

type ExistingRow = Pick<CraftDocumentRow, "craftDocId" | "preview" | "indexedAt" | "updatedAt" | "missing">;

type UpsertRow = {
  craftDocId: string;
  title: string;
  folderId: string | null;
  folderPath: string;
  updatedAt: Date | null;
  /** `undefined` keeps the stored preview. */
  preview?: string;
  /** `undefined` keeps the stored indexed_at. */
  indexedAt?: Date;
  missing: boolean;
};

/** Inserts or updates rows. A null preview / indexed_at in the payload keeps the stored value. */
export async function upsertDocuments(connectionId: string, rows: readonly UpsertRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = getDb();
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK).map((r) => ({
      connectionId,
      craftDocId: r.craftDocId,
      title: r.title,
      folderId: r.folderId,
      folderPath: r.folderPath,
      updatedAt: r.updatedAt,
      preview: r.preview ?? null,
      indexedAt: r.indexedAt ?? null,
      missing: r.missing,
    }));
    await db
      .insert(craftDocuments)
      .values(chunk)
      .onConflictDoUpdate({
        target: [craftDocuments.connectionId, craftDocuments.craftDocId],
        set: {
          title: sql`excluded.title`,
          folderId: sql`excluded.folder_id`,
          folderPath: sql`excluded.folder_path`,
          updatedAt: sql`coalesce(excluded.updated_at, ${craftDocuments.updatedAt})`,
          preview: sql`coalesce(excluded.preview, ${craftDocuments.preview})`,
          indexedAt: sql`coalesce(excluded.indexed_at, ${craftDocuments.indexedAt})`,
          missing: sql`excluded.missing`,
        },
      });
  }
}

function toDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function runFullRefresh(loaded: LoadedConnection, opts: RefreshOptions): Promise<FullRefreshResult> {
  const started = Date.now();
  const nowFn = opts.now ?? (() => new Date());
  const { connection, client } = loaded;
  const db = getDb();

  return runWithConnection(loaded, async () => {
    // 1. Folders
    const { folders, spaceId } = await client.listFoldersWithMeta();
    const folderPathById = new Map(folders.map((f) => [f.id, f.path]));

    // 2. Documents: root (no location) plus every folder, four listings at a time.
    const locations: Array<string | undefined> = [undefined, ...folders.map((f) => f.id)];
    const listings = await mapWithConcurrency(locations, LISTING_CONCURRENCY, (location) => client.listDocuments(location, { folderPathById }), {
      shouldStop: (err) => err instanceof CraftUnauthorizedError,
    });

    let listingComplete = true;
    const docsById = new Map<string, CraftDocument>();
    listings.forEach((result, i) => {
      if (!result) {
        listingComplete = false;
        return;
      }
      if (result.ok) {
        for (const doc of result.value) if (!docsById.has(doc.id)) docsById.set(doc.id, doc);
        return;
      }
      if (result.error instanceof CraftUnauthorizedError) throw result.error;
      // The root listing may legitimately be unsupported (400/404); other failures make the listing partial.
      const rootSoftFail = i === 0 && (result.error instanceof CraftRequestError || result.error instanceof CraftNotFoundError);
      if (!rootSoftFail) listingComplete = false;
    });
    const docs = [...docsById.values()];

    // 3. Decide which previews to fetch.
    const existingRows: ExistingRow[] = await db
      .select({
        craftDocId: craftDocuments.craftDocId,
        preview: craftDocuments.preview,
        indexedAt: craftDocuments.indexedAt,
        updatedAt: craftDocuments.updatedAt,
        missing: craftDocuments.missing,
      })
      .from(craftDocuments)
      .where(eq(craftDocuments.connectionId, connection.id));
    const existingById = new Map(existingRows.map((r) => [r.craftDocId ?? "", r]));

    const now = nowFn();
    const toFetch = docs.filter((doc) => needsPreview({ existing: existingById.get(doc.id), incomingUpdatedAt: doc.updatedAt, now }));

    // 4. Previews, four in flight.
    const previews = await mapWithConcurrency(
      toFetch,
      PREVIEW_CONCURRENCY,
      async (doc) => trimPreview(await client.getDocumentMarkdown(doc.id), undefined, doc.title),
      { shouldStop: (err) => err instanceof CraftUnauthorizedError },
    );

    let previewsFetched = 0;
    let missing = 0;
    let errors = 0;
    const previewById = new Map<string, { preview?: string; missing: boolean; indexedAt?: Date }>();
    previews.forEach((result, i) => {
      const doc = toFetch[i];
      if (!result) return; // not scheduled (stopped early)
      if (result.ok) {
        previewsFetched += 1;
        previewById.set(doc.id, { preview: result.value, missing: false, indexedAt: now });
      } else if (result.error instanceof CraftUnauthorizedError) {
        throw result.error;
      } else if (result.error instanceof CraftNotFoundError) {
        missing += 1;
        previewById.set(doc.id, { missing: true, indexedAt: now });
      } else {
        errors += 1;
      }
    });

    // 5. Upsert.
    const rows: UpsertRow[] = docs.map((doc) => {
      const fetched = previewById.get(doc.id);
      return {
        craftDocId: doc.id,
        title: doc.title,
        folderId: doc.folderId ?? null,
        folderPath: doc.folderPath,
        updatedAt: toDate(doc.updatedAt),
        preview: fetched?.preview,
        indexedAt: fetched?.indexedAt,
        missing: fetched?.missing ?? false,
      };
    });
    await upsertDocuments(connection.id, rows);

    // 6. Documents that are no longer listed are flagged missing (rows are kept so cards keep their preview).
    if (listingComplete && docs.length > 0) {
      await db
        .update(craftDocuments)
        .set({ missing: true })
        .where(and(eq(craftDocuments.connectionId, connection.id), notInArray(craftDocuments.craftDocId, docs.map((d) => d.id))));
    }

    // 7. Stamp the sync.
    await db
      .update(craftConnections)
      .set({
        lastFullSync: now,
        status: "ok",
        ...(spaceId && !connection.spaceId ? { spaceId } : {}),
      })
      .where(eq(craftConnections.id, connection.id));
    connection.lastFullSync = now;

    return { folders: folders.length, documents: docs.length, previewsFetched, missing, errors, durationMs: Date.now() - started };
  });
}

// ---------------------------------------------------------------------------

function toPreviewResponse(row: CraftDocumentRow, webUrl?: string): PreviewResponse {
  return {
    craftDocId: row.craftDocId ?? "",
    title: row.title ?? "Untitled",
    folderPath: row.folderPath ?? "",
    preview: row.preview ?? "",
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    indexedAt: (row.indexedAt ?? new Date()).toISOString(),
    missing: row.missing ?? false,
    ...(webUrl ? { webUrl } : {}),
  };
}

async function loadRow(connectionId: string, docId: string): Promise<CraftDocumentRow | undefined> {
  const rows = await getDb()
    .select()
    .from(craftDocuments)
    .where(and(eq(craftDocuments.connectionId, connectionId), eq(craftDocuments.craftDocId, docId)))
    .limit(1);
  return rows[0];
}

/**
 * Refreshes one document's preview. A 404 from Craft flags the row `missing`
 * (the row and its last preview are kept) and resolves normally so the card can
 * render the grey state; 401 flags the connection and rethrows.
 */
export async function refreshDocument(userId: string, docId: string, opts: { now?: () => Date } = {}): Promise<PreviewResponse> {
  const loaded = await getConnectionForUser(userId);
  const { connection, client } = loaded;
  const now = (opts.now ?? (() => new Date()))();
  const existing = await loadRow(connection.id, docId);

  let markdown: string;
  try {
    markdown = await runWithConnection(loaded, () => client.getDocumentMarkdown(docId));
  } catch (err) {
    if (err instanceof CraftNotFoundError) {
      await upsertDocuments(connection.id, [
        {
          craftDocId: docId,
          title: existing?.title ?? "Untitled",
          folderId: existing?.folderId ?? null,
          folderPath: existing?.folderPath ?? "",
          updatedAt: existing?.updatedAt ?? null,
          indexedAt: now,
          missing: true,
        },
      ]);
      const row = (await loadRow(connection.id, docId)) ?? {
        ...(existing ?? emptyRow(connection.id, docId)),
        missing: true,
        indexedAt: now,
      };
      return toPreviewResponse(row);
    }
    if (err instanceof CraftUnauthorizedError) {
      await markUnauthorized(connection.id).catch(() => undefined);
    }
    throw err;
  }

  const title = existing?.title ?? titleFromMarkdown(markdown) ?? "Untitled";
  const preview = trimPreview(markdown, undefined, title);
  await upsertDocuments(connection.id, [
    {
      craftDocId: docId,
      title,
      folderId: existing?.folderId ?? null,
      folderPath: existing?.folderPath ?? "",
      updatedAt: existing?.updatedAt ?? null,
      preview,
      indexedAt: now,
      missing: false,
    },
  ]);
  const row = (await loadRow(connection.id, docId)) ?? { ...emptyRow(connection.id, docId), title, preview, indexedAt: now };
  return toPreviewResponse(row);
}

function emptyRow(connectionId: string, docId: string): CraftDocumentRow {
  return {
    connectionId,
    craftDocId: docId,
    title: "Untitled",
    folderId: null,
    folderPath: "",
    updatedAt: null,
    preview: "",
    indexedAt: null,
    missing: false,
  };
}

/** Number of documents the index currently holds for a connection (missing ones excluded). */
export async function countDocuments(connectionId: string): Promise<number> {
  const rows = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(craftDocuments)
    .where(and(eq(craftDocuments.connectionId, connectionId), eq(craftDocuments.missing, false)));
  return rows[0]?.count ?? 0;
}

/** Local rows for a set of ids, used to decorate Craft results with `missing`. */
export async function loadRowsByIds(connectionId: string, ids: readonly string[]): Promise<Map<string, CraftDocumentRow>> {
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select()
    .from(craftDocuments)
    .where(and(eq(craftDocuments.connectionId, connectionId), inArray(craftDocuments.craftDocId, [...ids])));
  return new Map(rows.map((r) => [r.craftDocId ?? "", r]));
}
