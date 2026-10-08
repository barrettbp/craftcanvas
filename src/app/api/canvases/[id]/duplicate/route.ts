import { auth } from "@clerk/nextjs/server";

import { coerceData, copyTitle, isCanvasId, jsonError, toSummary } from "@/lib/canvas/api";
import { createCanvasForUser, getCanvasForUser, listCanvasesForUser } from "@/lib/canvas/repo";

type Context = { params: Promise<{ id: string }> };

/** POST /api/canvases/:id/duplicate: copies the document into a new canvas titled "<title> (copy)". */
export async function POST(_req: Request, { params }: Context) {
  const { userId } = await auth();
  if (!userId) return jsonError(401, "unauthorized");
  const { id } = await params;
  if (!isCanvasId(id)) return jsonError(404, "not_found");
  const source = await getCanvasForUser(userId, id);
  if (!source) return jsonError(404, "not_found");
  const existing = await listCanvasesForUser(userId);
  const title = copyTitle(source.title, existing.map((c) => c.title));
  const copy = await createCanvasForUser(userId, title, coerceData(source.data));
  return Response.json(toSummary(copy), { status: 201 });
}
