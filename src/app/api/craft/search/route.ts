/**
 * GET /api/craft/search?q=<text>&scope=local|all
 *   Local index first (ILIKE on title, then preview), then Craft search unless
 *   `scope=local`. Merged and de-duplicated by id, local rows first.
 *   200 SearchResponse = { query, documents: SearchResult[], counts: { local, craft }, craftError?: string }
 *       SearchResult   = { id, title, folderPath, updatedAt: string | null, source: "local" | "craft", missing?: boolean }
 */
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

import { craftDocuments, getDb } from "@/db";
import { craftErrorResponse, currentUserId, json, unauthenticated } from "@/lib/craft/api";
import { getConnectionForUser, runWithConnection } from "@/lib/craft/connection";
import { CraftUnauthorizedError } from "@/lib/craft/errors";
import { escapeLike, mergeSearchResults, normaliseQuery } from "@/lib/craft/search";
import type { SearchResponse, SearchResult } from "@/lib/craft/types";
import { rateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCAL_LIMIT = 50;

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return unauthenticated();
  const limited = rateLimited(userId, "craft"); if (limited) return limited;

  const url = new URL(req.url);
  const query = normaliseQuery(url.searchParams.get("q"));
  const scope = url.searchParams.get("scope") === "local" ? "local" : "all";

  if (query.length === 0) {
    return json<SearchResponse>({ query, documents: [], counts: { local: 0, craft: 0 } });
  }

  let loaded;
  try {
    loaded = await getConnectionForUser(userId);
  } catch (err) {
    return craftErrorResponse(err, "api/craft/search");
  }
  const { connection, client } = loaded;

  try {
    const pattern = `%${escapeLike(query)}%`;
    const titleMatch = ilike(craftDocuments.title, pattern);
    const rows = await getDb()
      .select({
        id: craftDocuments.craftDocId,
        title: craftDocuments.title,
        folderPath: craftDocuments.folderPath,
        updatedAt: craftDocuments.updatedAt,
        missing: craftDocuments.missing,
      })
      .from(craftDocuments)
      .where(and(eq(craftDocuments.connectionId, connection.id), or(titleMatch, ilike(craftDocuments.preview, pattern))))
      .orderBy(sql`case when ${titleMatch} then 0 else 1 end`, desc(craftDocuments.updatedAt))
      .limit(LOCAL_LIMIT);

    const local: SearchResult[] = rows.map((r) => ({
      id: r.id ?? "",
      title: r.title ?? "Untitled",
      folderPath: r.folderPath ?? "",
      updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
      source: "local",
      missing: r.missing ?? false,
    }));

    if (scope === "local") {
      return json<SearchResponse>({ query, documents: local, counts: { local: local.length, craft: 0 } });
    }

    let craft: SearchResult[] = [];
    let craftError: string | undefined;
    try {
      const docs = await runWithConnection(loaded, () => client.searchDocuments(query));
      craft = docs.map((d) => ({
        id: d.id,
        title: d.title,
        folderPath: d.folderPath,
        updatedAt: d.updatedAt ?? null,
        source: "craft",
      }));
    } catch (err) {
      if (err instanceof CraftUnauthorizedError) return craftErrorResponse(err, "api/craft/search");
      craftError = err instanceof Error ? err.name : "craft_error";
    }

    const documents = mergeSearchResults(local, craft);
    return json<SearchResponse>({
      query,
      documents,
      counts: { local: local.length, craft: documents.length - local.length },
      ...(craftError ? { craftError } : {}),
    });
  } catch (err) {
    return craftErrorResponse(err, "api/craft/search");
  }
}
