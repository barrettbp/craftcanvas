/**
 * POST /api/craft/connect
 *   body { baseUrl, apiKey, label?, dryRun? }
 *   Tests the credentials with GET /folders. With `dryRun: true` nothing is
 *   stored ("Test connection"). Otherwise the key is encrypted and stored,
 *   and a full index refresh is started in the background.
 *   200 { ok: true, dryRun: boolean, host, label, folderCount, connection?: { id, status } }
 *
 * DELETE /api/craft/connect
 *   Removes the connection and its document index.
 *   200 { ok: true, deleted: boolean }
 */
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { craftConnections, craftDocuments, getDb, users } from "@/db";
import { craftErrorResponse, currentUserId, errorResponse, invalidRequest, json, unauthenticated } from "@/lib/craft/api";
import { createCraftClient, normaliseBaseUrl } from "@/lib/craft/client";
import { hostOf } from "@/lib/craft/connection";
import { startFullRefresh } from "@/lib/craft/indexer";
import { encrypt } from "@/lib/crypto/aes";
import { log } from "@/lib/log";
import { rateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Only Craft hosts are accepted. Our server proxies requests with the stored
 * key, so an arbitrary URL would turn the proxy into an SSRF vector.
 */
const ALLOWED_HOST_SUFFIXES = ["craft.do"];

const bodySchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .min(1, "Connection URL is required")
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" && ALLOWED_HOST_SUFFIXES.some((s) => url.hostname === s || url.hostname.endsWith(`.${s}`));
      } catch {
        return false;
      }
    }, "Connection URL must be an https URL on craft.do, like https://connect.craft.do/links/XXXX/api/v1"),
  apiKey: z
    .string()
    .trim()
    .min(8, "API key is required")
    .max(512)
    .refine((value) => value.startsWith("pdk_"), "API key should start with pdk_"),
  label: z.string().trim().max(80).optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return unauthenticated();
  const limited = rateLimited(userId, "craft"); if (limited) return limited;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse(400, "invalid_json");
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return invalidRequest(parsed.error);

  const baseUrl = normaliseBaseUrl(parsed.data.baseUrl);
  const apiKey = parsed.data.apiKey;
  const label = parsed.data.label || "Craft space";
  const host = hostOf(baseUrl);

  // 1. Test the credentials before anything touches the database.
  let folderCount: number;
  let spaceId: string | undefined;
  try {
    const client = createCraftClient({ baseUrl, apiKey });
    const result = await client.listFoldersWithMeta();
    folderCount = result.folders.length;
    spaceId = result.spaceId;
  } catch (err) {
    return craftErrorResponse(err, "api/craft/connect");
  }

  if (parsed.data.dryRun) {
    return json({ ok: true as const, dryRun: true as const, host, label, folderCount });
  }

  // 2. Store encrypted.
  try {
    const db = getDb();
    const { cipher, iv } = encrypt(apiKey);

    // The Clerk webhook normally creates the users row; make sure it exists so the FK holds.
    await db.insert(users).values({ id: userId }).onConflictDoNothing();

    // A different space invalidates the old index; the same space keeps it.
    const previous = await db
      .select({ id: craftConnections.id, baseUrl: craftConnections.baseUrl })
      .from(craftConnections)
      .where(eq(craftConnections.userId, userId))
      .limit(1);
    if (previous[0] && previous[0].baseUrl !== baseUrl) {
      await db.delete(craftDocuments).where(eq(craftDocuments.connectionId, previous[0].id));
    }

    const inserted = await db
      .insert(craftConnections)
      .values({
        id: randomUUID(),
        userId,
        baseUrl,
        apiKeyCipher: cipher,
        apiKeyIv: iv,
        spaceId: spaceId ?? null,
        label,
        status: "ok",
        lastFullSync: null,
      })
      .onConflictDoUpdate({
        target: craftConnections.userId,
        set: {
          baseUrl,
          apiKeyCipher: cipher,
          apiKeyIv: iv,
          label,
          status: "ok",
          lastFullSync: null,
          ...(spaceId ? { spaceId } : {}),
        },
      })
      .returning({ id: craftConnections.id, status: craftConnections.status });

    const connection = inserted[0];

    // 3. Kick off the initial index without waiting for it.
    startFullRefresh(userId, { force: true }).catch((err: unknown) => {
      log.error("api/craft/connect could not start initial index", { err });
    });

    return json({
      ok: true as const,
      dryRun: false as const,
      host,
      label,
      folderCount,
      connection: { id: connection.id, status: connection.status ?? "ok" },
    });
  } catch (err) {
    return craftErrorResponse(err, "api/craft/connect");
  }
}

export async function DELETE() {
  const userId = await currentUserId();
  if (!userId) return unauthenticated();
  const limited = rateLimited(userId, "craft"); if (limited) return limited;

  try {
    // Documents cascade from the connection, but delete explicitly so the wipe
    // does not depend on the FK being present.
    const db = getDb();
    const existing = await db.select({ id: craftConnections.id }).from(craftConnections).where(eq(craftConnections.userId, userId)).limit(1);
    if (!existing[0]) return json({ ok: true as const, deleted: false });
    await db.delete(craftDocuments).where(eq(craftDocuments.connectionId, existing[0].id));
    await db.delete(craftConnections).where(and(eq(craftConnections.id, existing[0].id), eq(craftConnections.userId, userId)));
    return json({ ok: true as const, deleted: true });
  } catch (err) {
    return craftErrorResponse(err, "api/craft/connect");
  }
}
