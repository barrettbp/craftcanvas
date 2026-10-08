/**
 * POST /api/craft/refresh[?ifStale=1]
 *   Starts a full index refresh in the background.
 *   202 { started: true,  alreadyRunning: false, reason: "requested" | "stale" }
 *   200 { started: false, alreadyRunning: true }           a refresh is running
 *   200 { started: false, alreadyRunning: false, reason: "fresh", lastFullSync }   ifStale=1 and synced < 15 min ago
 *   429 { error: "refresh_rate_limited", retryAfter }      last refresh finished < 1 min ago (Retry-After set)
 *   Poll GET /api/craft/status (`syncing`, `lastFullSync`, `documentCount`) for progress.
 */
import { craftErrorResponse, currentUserId, json, unauthenticated } from "@/lib/craft/api";
import { findConnectionForUser } from "@/lib/craft/connection";
import { CraftNotConnectedError } from "@/lib/craft/errors";
import { isRefreshInFlight, isStale, startFullRefresh } from "@/lib/craft/indexer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type RefreshResponse =
  | { started: true; alreadyRunning: false; reason: "requested" | "stale" }
  | { started: false; alreadyRunning: true }
  | { started: false; alreadyRunning: false; reason: "fresh"; lastFullSync: string | null };

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return unauthenticated();

  const url = new URL(req.url);
  const ifStale = ["1", "true"].includes((url.searchParams.get("ifStale") ?? "").toLowerCase());

  try {
    if (isRefreshInFlight(userId)) return json<RefreshResponse>({ started: false, alreadyRunning: true });

    if (ifStale) {
      const connection = await findConnectionForUser(userId);
      if (!connection) throw new CraftNotConnectedError();
      if (!isStale(connection.lastFullSync)) {
        return json<RefreshResponse>({
          started: false,
          alreadyRunning: false,
          reason: "fresh",
          lastFullSync: connection.lastFullSync ? connection.lastFullSync.toISOString() : null,
        });
      }
    }

    const result = await startFullRefresh(userId);
    if (result.alreadyRunning) return json<RefreshResponse>({ started: false, alreadyRunning: true });
    return json<RefreshResponse>({ started: true, alreadyRunning: false, reason: ifStale ? "stale" : "requested" }, { status: 202 });
  } catch (err) {
    return craftErrorResponse(err, "api/craft/refresh");
  }
}
