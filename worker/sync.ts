/**
 * Batched, resumable import from a NoteSource into D1.
 *
 * Call runSyncStep(null) to enumerate documents and store the pending list, then call it with the
 * returned cursor until done. Each step fetches at most BATCH documents so one HTTP request stays short
 * and Craft's rate limits are respected across calls.
 */
import type { Bindings } from "./env";
import type { DocRef } from "./craft/parse";
import { cleanMarkdown, deepLinks, extractLinks, makePreview, titleFromMarkdown } from "./craft/parse";
import type { NoteSource } from "./craft/source";
import { CraftApiError } from "./craft/client";
import { nowIso } from "./util";
import type { SyncResult, SyncStatus } from "../shared/types";

const BATCH = 8;
const RUNNING_STALE_MS = 3 * 60_000;

type Pending = {
  spaceId: string | null;
  docs: DocRef[];
  meta: Record<string, Record<string, unknown>>;
  startedAt: string;
  seen: string[];
  /** Index of the next document to fetch. The posted cursor must match it. */
  next: number;
  /** True when enumeration could not list every folder; unseen notes are then NOT marked deleted. */
  partial: boolean;
  skipped: string[];
};

async function getState(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM sync_state WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setState(db: D1Database, key: string, value: string | null): Promise<void> {
  if (value === null) await db.prepare("DELETE FROM sync_state WHERE key = ?").bind(key).run();
  else await db.prepare("INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}

export async function syncStatus(env: Bindings, mode: "fixture" | "craft"): Promise<SyncStatus> {
  const db = env.DB;
  const [notes, links, last, running] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM notes WHERE deleted = 0").first<{ n: number }>(),
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM links l JOIN notes s ON s.id = l.source_note_id AND s.deleted = 0 JOIN notes t ON t.id = l.target_note_id AND t.deleted = 0",
      )
      .first<{ n: number }>(),
    getState(db, "last_sync_at"),
    getState(db, "running_since"),
  ]);
  const runningSince = running ? Date.parse(running) : NaN;
  return {
    lastSyncAt: last,
    noteCount: notes?.n ?? 0,
    linkCount: links?.n ?? 0,
    mode,
    running: Number.isFinite(runningSince) && Date.now() - runningSince < RUNNING_STALE_MS,
  };
}

export async function runSyncStep(env: Bindings, source: NoteSource, cursor: string | null): Promise<SyncResult> {
  const db = env.DB;
  let pending: Pending;
  let index: number;

  if (cursor === null) {
    const e = await source.enumerate();
    pending = { spaceId: e.spaceId, docs: e.docs, meta: e.meta, startedAt: nowIso(), seen: [], next: 0, partial: e.partial, skipped: [] };
    index = 0;
    await setState(db, "pending", JSON.stringify(pending));
    await setState(db, "running_since", pending.startedAt);
    await setState(db, "mode", source.mode);
  } else {
    const raw = await getState(db, "pending");
    index = parseInt(cursor, 10);
    if (!raw || !Number.isFinite(index) || index < 0) {
      throw new SyncError("bad_cursor", "No sync in progress for this cursor. Start again with cursor null.");
    }
    pending = JSON.parse(raw) as Pending;
    if (index !== pending.next) {
      throw new SyncError("bad_cursor", `Expected cursor ${pending.next}, got ${index}. Continue with the cursor from the last response or start again with cursor null.`);
    }
    await setState(db, "running_since", nowIso());
  }

  const slice = pending.docs.slice(index, index + BATCH);
  const stmts: D1PreparedStatement[] = [];
  const syncedAt = nowIso();
  let importedNow = 0;

  for (const ref of slice) {
    let doc;
    try {
      doc = await source.fetchDocument(ref, pending.meta[ref.id]);
    } catch (e) {
      // A document removed or unshared between enumeration and fetch must not block the whole sync.
      if (e instanceof CraftApiError && (e.status === 403 || e.status === 404 || e.status === 410)) {
        pending.skipped.push(ref.id);
        continue;
      }
      throw e;
    }
    const title = doc.title || titleFromMarkdown(doc.markdown) || "Untitled";
    const markdown = cleanMarkdown(doc.markdown);
    const preview = makePreview(doc.markdown);
    const dl = deepLinks(pending.spaceId, doc.id, doc.deepLinkApp);

    stmts.push(
      db
        .prepare(
          `INSERT INTO notes (id, space_id, title, folder_id, folder_name, created_at, modified_at, markdown, preview, deep_link_app, deep_link_web, synced_at, deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
           ON CONFLICT(id) DO UPDATE SET space_id = excluded.space_id, title = excluded.title, folder_id = excluded.folder_id,
             folder_name = excluded.folder_name, created_at = excluded.created_at, modified_at = excluded.modified_at,
             markdown = excluded.markdown, preview = excluded.preview, deep_link_app = excluded.deep_link_app,
             deep_link_web = excluded.deep_link_web, synced_at = excluded.synced_at, deleted = 0`,
        )
        .bind(doc.id, pending.spaceId, title, doc.folderId, doc.folderName, doc.createdAt, doc.modifiedAt, markdown, preview, dl.app, dl.web, syncedAt),
    );
    stmts.push(db.prepare("DELETE FROM links WHERE source_note_id = ?").bind(doc.id));
    for (const l of extractLinks(doc.markdown)) {
      stmts.push(
        db
          .prepare("INSERT OR REPLACE INTO links (source_note_id, target_block_id, target_note_id, label, out_of_scope) VALUES (?, ?, NULL, ?, ?)")
          .bind(doc.id, l.targetBlockId, l.label, l.outOfScope ? 1 : 0),
      );
    }
    stmts.push(db.prepare("DELETE FROM note_blocks WHERE note_id = ?").bind(doc.id));
    for (const b of doc.blockIds) {
      stmts.push(db.prepare("INSERT OR REPLACE INTO note_blocks (block_id, note_id) VALUES (?, ?)").bind(b, doc.id));
    }
    pending.seen.push(doc.id);
    importedNow += 1;
  }

  // D1 batch is transactional; chunk to stay well under statement limits.
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));

  const next = index + slice.length;
  const done = next >= pending.docs.length;
  pending.next = next;

  if (done) {
    // Resolve links to notes (direct id match or via a sub-block id), mark unseen notes as deleted, finish.
    // When enumeration was partial we cannot tell "gone" from "not listed", so nothing is marked deleted.
    const seen = new Set(pending.seen);
    const existing = pending.partial ? { results: [] as { id: string }[] } : await db.prepare("SELECT id FROM notes WHERE deleted = 0").all<{ id: string }>();
    const gone = (existing.results ?? []).map((r) => r.id).filter((id) => !seen.has(id));
    const finish: D1PreparedStatement[] = [
      db.prepare(
        `UPDATE links SET target_note_id = (
           SELECT nb.note_id FROM note_blocks nb WHERE nb.block_id = links.target_block_id
         ) WHERE out_of_scope = 0`,
      ),
      db.prepare("INSERT INTO sync_state (key, value) VALUES ('last_sync_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(nowIso()),
      db.prepare("DELETE FROM sync_state WHERE key IN ('pending', 'running_since')"),
    ];
    for (const id of gone) finish.push(db.prepare("UPDATE notes SET deleted = 1 WHERE id = ?").bind(id));
    // Real data replaces the bundled samples.
    if (source.mode === "craft") finish.push(db.prepare("UPDATE notes SET deleted = 1 WHERE space_id = 'fixture-space'"));
    for (let i = 0; i < finish.length; i += 90) await db.batch(finish.slice(i, i + 90));
  } else {
    await setState(db, "pending", JSON.stringify(pending));
  }

  return { done, cursor: done ? null : String(next), imported: importedNow, total: pending.docs.length, mode: source.mode, skipped: pending.skipped.length, partial: pending.partial };
}

export class SyncError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
