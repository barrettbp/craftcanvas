import { auth } from "@clerk/nextjs/server";

import { coerceData, isCanvasId, jsonError } from "@/lib/canvas/api";
import { getCanvasForUser } from "@/lib/canvas/repo";
import { CANVAS_FILE_MIME, contentDisposition, filenameFor, serialiseCanvasFile } from "@/lib/export/canvas-file";
import { rateLimited } from "@/lib/rate-limit";

type Context = { params: Promise<{ id: string }> };

/** GET /api/canvases/:id/export: the document as a downloadable JSON Canvas `.canvas` file. */
export async function GET(_req: Request, { params }: Context) {
  const { userId } = await auth();
  if (!userId) return jsonError(401, "unauthorized");
  const limited = rateLimited(userId, "canvases"); if (limited) return limited;
  const { id } = await params;
  if (!isCanvasId(id)) return jsonError(404, "not_found");
  const row = await getCanvasForUser(userId, id);
  if (!row) return jsonError(404, "not_found");

  const body = serialiseCanvasFile(coerceData(row.data));
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": `${CANVAS_FILE_MIME}; charset=utf-8`,
      "content-disposition": contentDisposition(filenameFor(row.title)),
      "cache-control": "no-store",
    },
  });
}
