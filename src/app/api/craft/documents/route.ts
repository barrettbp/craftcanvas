/**
 * GET /api/craft/documents?location=<folderId>
 *   Lists the documents Craft reports for a location (omit for the root).
 *   Rows are written to the local index (title and folder only; previews are
 *   left alone). When Craft is unreachable the local index answers instead.
 *   200 { location: string | null, source: "craft" | "local",
 *         documents: { id, title, folderId: string | null, folderPath, updatedAt: string | null, webUrl?: string, missing: boolean }[] }
 */
import { and, eq, isNull } from "drizzle-orm";

import { craftDocuments, getDb } from "@/db";
import { craftErrorResponse, currentUserId, json, unauthenticated } from "@/lib/craft/api";
import { getConnectionForUser, runWithConnection } from "@/lib/craft/connection";
import { CraftNetworkError, CraftServerError, CraftTimeoutError, CraftUnauthorizedError } from "@/lib/craft/errors";
import { upsertDocuments } from "@/lib/craft/indexer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type DocumentRow = {
  id: string;
  title: string;
  folderId: string | null;
  folderPath: string;
  updatedAt: string | null;
  webUrl?: string;
  missing: boolean;
};

export type DocumentsResponse = { location: string | null; source: "craft" | "local"; documents: DocumentRow[] };

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return unauthenticated();

  const url = new URL(req.url);
  const location = (url.searchParams.get("location") ?? "").trim().slice(0, 200) || null;

  let loaded;
  try {
    loaded = await getConnectionForUser(userId);
  } catch (err) {
    return craftErrorResponse(err, "api/craft/documents");
  }
  const { connection, client } = loaded;

  try {
    const [{ folders }, docs] = await runWithConnection(loaded, () =>
      Promise.all([client.listFoldersWithMeta(), client.listDocuments(location ?? undefined)]),
    );
    const folderPathById = new Map(folders.map((f) => [f.id, f.path]));

    const rows = docs.map((d) => ({
      ...d,
      folderPath: d.folderPath || (d.folderId ? (folderPathById.get(d.folderId) ?? "") : ""),
    }));

    // Keep the index's titles and folders fresh; previews are untouched.
    await upsertDocuments(
      connection.id,
      rows.map((d) => ({
        craftDocId: d.id,
        title: d.title,
        folderId: d.folderId ?? null,
        folderPath: d.folderPath,
        updatedAt: d.updatedAt ? new Date(d.updatedAt) : null,
        missing: false,
      })),
    ).catch((err: unknown) => {
      console.warn("[api/craft/documents] index update failed", err instanceof Error ? err.message : err);
    });

    return json<DocumentsResponse>({
      location,
      source: "craft",
      documents: rows.map((d) => ({
        id: d.id,
        title: d.title,
        folderId: d.folderId ?? null,
        folderPath: d.folderPath,
        updatedAt: d.updatedAt ?? null,
        ...(d.webUrl ? { webUrl: d.webUrl } : {}),
        missing: false,
      })),
    });
  } catch (err) {
    if (err instanceof CraftUnauthorizedError) return craftErrorResponse(err, "api/craft/documents");
    const transient = err instanceof CraftTimeoutError || err instanceof CraftNetworkError || err instanceof CraftServerError;
    if (!transient) return craftErrorResponse(err, "api/craft/documents");

    // Fall back to the local index so the panel still works offline from Craft.
    try {
      const local = await getDb()
        .select()
        .from(craftDocuments)
        .where(
          and(
            eq(craftDocuments.connectionId, connection.id),
            location ? eq(craftDocuments.folderId, location) : isNull(craftDocuments.folderId),
            eq(craftDocuments.missing, false),
          ),
        )
        .limit(500);
      return json<DocumentsResponse>({
        location,
        source: "local",
        documents: local.map((r) => ({
          id: r.craftDocId ?? "",
          title: r.title ?? "Untitled",
          folderId: r.folderId ?? null,
          folderPath: r.folderPath ?? "",
          updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
          missing: r.missing ?? false,
        })),
      });
    } catch (dbErr) {
      return craftErrorResponse(dbErr, "api/craft/documents");
    }
  }
}
