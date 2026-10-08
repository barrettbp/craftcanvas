/**
 * GET /api/craft/preview/:docId
 *   Fetches the document's markdown, updates the index and returns the
 *   shared PreviewResponse contract:
 *   200 { craftDocId, title, folderPath, preview, updatedAt: string | null, indexedAt, missing, webUrl? }
 *   A 404 from Craft flags the row `missing: true` and still answers 200 so the
 *   card can render its grey state.
 */
import { craftErrorResponse, currentUserId, errorResponse, json, unauthenticated } from "@/lib/craft/api";
import { refreshDocument } from "@/lib/craft/indexer";
import type { PreviewResponse } from "@/lib/craft/types";
import { rateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ docId: string }> }) {
  const userId = await currentUserId();
  if (!userId) return unauthenticated();
  const limited = rateLimited(userId, "craft"); if (limited) return limited;

  const { docId } = await ctx.params;
  const id = decodeURIComponent(docId ?? "").trim();
  if (!id || id.length > 200) return errorResponse(400, "invalid_request", { message: "docId is required" });

  try {
    const preview = await refreshDocument(userId, id);
    return json<PreviewResponse>(preview, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return craftErrorResponse(err, "api/craft/preview");
  }
}
