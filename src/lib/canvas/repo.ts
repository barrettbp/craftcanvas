/**
 * Data access for canvases. Every function takes the Clerk `userId` and scopes
 * the query by it; nothing here can read another user's rows. The route
 * handlers call these and are tested with this module mocked.
 */
import { and, desc, eq, sql } from "drizzle-orm";

import { canvases, craftConnections, getDb, users, type Canvas } from "@/db";

import type { CanvasData } from "./types";

export type CanvasRow = Canvas;

export async function listCanvasesForUser(userId: string): Promise<CanvasRow[]> {
  return getDb().select().from(canvases).where(eq(canvases.userId, userId)).orderBy(desc(canvases.updatedAt));
}

export async function getCanvasForUser(userId: string, id: string): Promise<CanvasRow | null> {
  const rows = await getDb()
    .select()
    .from(canvases)
    .where(and(eq(canvases.id, id), eq(canvases.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Makes sure the `users` row exists. The Clerk webhook normally creates it,
 * but a user can reach the app before the webhook is delivered.
 */
export async function ensureUser(userId: string): Promise<void> {
  await getDb().insert(users).values({ id: userId }).onConflictDoNothing();
}

export async function createCanvasForUser(userId: string, title: string, data: CanvasData): Promise<CanvasRow> {
  await ensureUser(userId);
  const rows = await getDb()
    .insert(canvases)
    .values({ id: crypto.randomUUID(), userId, title, data, version: 1 })
    .returning();
  return rows[0];
}

/**
 * Saves `data` only when the stored version still equals `expectedVersion`.
 * Returns the updated row, or `null` when the version moved (or the row is
 * gone), in which case the caller decides between 404 and 409.
 */
export async function saveCanvasIfVersion(
  userId: string,
  id: string,
  data: CanvasData,
  expectedVersion: number,
): Promise<CanvasRow | null> {
  const rows = await getDb()
    .update(canvases)
    .set({ data, version: expectedVersion + 1, updatedAt: sql`now()` })
    .where(and(eq(canvases.id, id), eq(canvases.userId, userId), eq(canvases.version, expectedVersion)))
    .returning();
  return rows[0] ?? null;
}

export async function renameCanvasForUser(userId: string, id: string, title: string): Promise<CanvasRow | null> {
  const rows = await getDb()
    .update(canvases)
    .set({ title, updatedAt: sql`now()` })
    .where(and(eq(canvases.id, id), eq(canvases.userId, userId)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteCanvasForUser(userId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(canvases)
    .where(and(eq(canvases.id, id), eq(canvases.userId, userId)))
    .returning({ id: canvases.id });
  return rows.length > 0;
}

/**
 * Stores the thumbnail (storage URL or data URL) without bumping `version` or
 * `updatedAt`: a snapshot is not an edit. Returns `null` when the canvas is
 * missing or owned by someone else.
 */
export async function setCanvasThumbnailForUser(userId: string, id: string, thumbnail: string): Promise<CanvasRow | null> {
  const rows = await getDb()
    .update(canvases)
    .set({ thumbnail })
    .where(and(eq(canvases.id, id), eq(canvases.userId, userId)))
    .returning();
  return rows[0] ?? null;
}

export async function userHasCraftConnection(userId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: craftConnections.id })
    .from(craftConnections)
    .where(eq(craftConnections.userId, userId))
    .limit(1);
  return rows.length > 0;
}
