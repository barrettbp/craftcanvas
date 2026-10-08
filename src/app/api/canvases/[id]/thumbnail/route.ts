import { auth } from "@clerk/nextjs/server";

import { isCanvasId, jsonError, readJson } from "@/lib/canvas/api";
import { getCanvasForUser, setCanvasThumbnailForUser } from "@/lib/canvas/repo";
import { env } from "@/lib/env";
import { decideThumbnailStorage, parsePngDataUrl, thumbnailBodySchema } from "@/lib/export/thumbnail-storage";
import { uploadThumbnailToSupabase } from "@/lib/export/thumbnail-upload";

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/canvases/:id/thumbnail { dataUrl }: stores a small PNG snapshot of
 * the canvas (spec 8.7). With Supabase configured the bytes go to Storage at
 * `<userId>/<canvasId>.png` and the public URL is kept in `canvases.thumbnail`;
 * otherwise the data URL itself is stored. 200 { thumbnail }.
 */
export async function POST(req: Request, { params }: Context) {
  const { userId } = await auth();
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  if (!isCanvasId(id)) return jsonError(404, "not_found");

  const parsed = thumbnailBodySchema.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(400, "invalid_body", { issues: parsed.error.issues });
  const png = parsePngDataUrl(parsed.data.dataUrl);
  if (!png.ok) return jsonError(png.reason === "too_large" ? 413 : 400, png.reason);

  const existing = await getCanvasForUser(userId, id);
  if (!existing) return jsonError(404, "not_found");

  const decision = decideThumbnailStorage({
    hasSupabase: env.hasSupabase(),
    bucket: env.supabaseThumbnailBucket(),
    userId,
    canvasId: id,
  });

  let thumbnail: string;
  if (decision.kind === "supabase") {
    try {
      thumbnail = await uploadThumbnailToSupabase({
        bucket: decision.bucket,
        path: decision.path,
        bytes: Buffer.from(png.png.base64, "base64"),
      });
    } catch (error) {
      console.error("[thumbnail] upload failed", error instanceof Error ? error.message : error);
      return jsonError(502, "upload_failed");
    }
  } else {
    thumbnail = parsed.data.dataUrl;
  }

  const row = await setCanvasThumbnailForUser(userId, id, thumbnail);
  if (!row) return jsonError(404, "not_found");
  return Response.json({ thumbnail: row.thumbnail ?? thumbnail });
}
