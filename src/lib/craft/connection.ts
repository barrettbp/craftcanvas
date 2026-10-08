/**
 * Loads a user's Craft connection, decrypts the key and builds a client.
 *
 * The decrypted key only ever lives inside the client closure. Nothing in
 * this module returns it, and `SafeConnection` deliberately omits the cipher
 * and IV columns so a connection object can be serialised without risk.
 */
import { and, eq } from "drizzle-orm";

import { craftConnections, getDb } from "@/db";
import { decrypt } from "@/lib/crypto/aes";

import { createCraftClient, type CraftClient } from "./client";
import { CraftNotConnectedError, CraftUnauthorizedError } from "./errors";
import type { CraftConnectionStatus } from "./types";

export type SafeConnection = {
  id: string;
  userId: string;
  baseUrl: string;
  /** Host part of `baseUrl`, safe to show in the UI. */
  host: string | null;
  spaceId: string | null;
  label: string | null;
  lastFullSync: Date | null;
  status: CraftConnectionStatus;
  createdAt: Date | null;
};

export type LoadedConnection = { connection: SafeConnection; client: CraftClient };

export function hostOf(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}

function toStatus(value: string | null | undefined): CraftConnectionStatus {
  return value === "unauthorized" || value === "error" ? value : "ok";
}

type Row = typeof craftConnections.$inferSelect;

function toSafe(row: Row): SafeConnection {
  return {
    id: row.id,
    userId: row.userId ?? "",
    baseUrl: row.baseUrl,
    host: hostOf(row.baseUrl),
    spaceId: row.spaceId ?? null,
    label: row.label ?? null,
    lastFullSync: row.lastFullSync ?? null,
    status: toStatus(row.status),
    createdAt: row.createdAt ?? null,
  };
}

/** The user's connection without secrets, or `null` when not connected. */
export async function findConnectionForUser(userId: string): Promise<SafeConnection | null> {
  const rows = await getDb().select().from(craftConnections).where(eq(craftConnections.userId, userId)).limit(1);
  const row = rows[0];
  return row ? toSafe(row) : null;
}

/**
 * Loads the connection and builds a client with the decrypted key.
 * Throws `CraftNotConnectedError` when the user has no connection.
 */
export async function getConnectionForUser(userId: string): Promise<LoadedConnection> {
  const rows = await getDb().select().from(craftConnections).where(eq(craftConnections.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) throw new CraftNotConnectedError();
  const apiKey = decrypt({ cipher: row.apiKeyCipher, iv: row.apiKeyIv });
  const client = createCraftClient({ baseUrl: row.baseUrl, apiKey });
  return { connection: toSafe(row), client };
}

export async function setConnectionStatus(connectionId: string, status: CraftConnectionStatus): Promise<void> {
  await getDb().update(craftConnections).set({ status }).where(eq(craftConnections.id, connectionId));
}

/** Records that Craft rejected the key. The reconnect banner keys off this. */
export async function markUnauthorized(connectionId: string): Promise<void> {
  await setConnectionStatus(connectionId, "unauthorized");
}

/** Clears a stale unauthorized/error flag after a successful call. */
export async function markOkIfNeeded(connection: SafeConnection): Promise<void> {
  if (connection.status === "ok") return;
  await getDb()
    .update(craftConnections)
    .set({ status: "ok" })
    .where(and(eq(craftConnections.id, connection.id), eq(craftConnections.userId, connection.userId)));
  connection.status = "ok";
}

/**
 * Runs `fn` with the user's client. On `CraftUnauthorizedError` the connection
 * is flagged before the error is rethrown; on success a stale flag is cleared.
 */
export async function withCraft<T>(userId: string, fn: (loaded: LoadedConnection) => Promise<T>): Promise<T> {
  const loaded = await getConnectionForUser(userId);
  return runWithConnection(loaded, fn);
}

export async function runWithConnection<T>(loaded: LoadedConnection, fn: (loaded: LoadedConnection) => Promise<T>): Promise<T> {
  try {
    const result = await fn(loaded);
    await markOkIfNeeded(loaded.connection).catch(() => undefined);
    return result;
  } catch (err) {
    if (err instanceof CraftUnauthorizedError) {
      await markUnauthorized(loaded.connection.id).catch(() => undefined);
      loaded.connection.status = "unauthorized";
    }
    throw err;
  }
}
