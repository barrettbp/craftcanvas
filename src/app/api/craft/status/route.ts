/**
 * GET /api/craft/status
 *   200 CraftStatusResponse = { connected, status: "ok" | "unauthorized" | "error" | null,
 *                               lastFullSync: string | null, label: string | null,
 *                               host: string | null, documentCount, syncing,
 *                               connectionId?, spaceId? }
 *   Works for users without a connection (`connected: false`). Never includes
 *   the key, cipher, IV or the full connection URL.
 */
import { craftErrorResponse, currentUserId, json, unauthenticated } from "@/lib/craft/api";
import { findConnectionForUser } from "@/lib/craft/connection";
import { countDocuments, isRefreshInFlight } from "@/lib/craft/indexer";
import type { CraftStatusResponse } from "@/lib/craft/types";
import { rateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return unauthenticated();
  const limited = rateLimited(userId, "craft"); if (limited) return limited;

  try {
    const connection = await findConnectionForUser(userId);
    if (!connection) {
      return json<CraftStatusResponse>(
        { connected: false, status: null, lastFullSync: null, label: null, host: null, documentCount: 0, syncing: false },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const documentCount = await countDocuments(connection.id);
    return json<CraftStatusResponse>(
      {
        connected: true,
        status: connection.status,
        lastFullSync: connection.lastFullSync ? connection.lastFullSync.toISOString() : null,
        label: connection.label,
        host: connection.host,
        documentCount,
        syncing: isRefreshInFlight(userId),
        connectionId: connection.id,
        spaceId: connection.spaceId,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return craftErrorResponse(err, "api/craft/status");
  }
}
