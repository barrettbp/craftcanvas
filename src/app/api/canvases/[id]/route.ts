import { auth } from "@clerk/nextjs/server";

import {
  decideVersion,
  isCanvasId,
  jsonError,
  readJson,
  renameCanvasBodySchema,
  saveCanvasBodySchema,
  toDetail,
  toSummary,
} from "@/lib/canvas/api";
import { deleteCanvasForUser, getCanvasForUser, renameCanvasForUser, saveCanvasIfVersion } from "@/lib/canvas/repo";
import { rateLimited } from "@/lib/rate-limit";

type Context = { params: Promise<{ id: string }> };

/** GET /api/canvases/:id: the canvas with its document. */
export async function GET(_req: Request, { params }: Context) {
  const { userId } = await auth();
  if (!userId) return jsonError(401, "unauthorized");
  const limited = rateLimited(userId, "canvases"); if (limited) return limited;
  const { id } = await params;
  if (!isCanvasId(id)) return jsonError(404, "not_found");
  const row = await getCanvasForUser(userId, id);
  if (!row) return jsonError(404, "not_found");
  return Response.json(toDetail(row));
}

/**
 * PUT /api/canvases/:id { data, version }: autosave with optimistic
 * concurrency. 200 { version, updatedAt }; 409 { error: "version_conflict",
 * version } when another tab saved first.
 */
export async function PUT(req: Request, { params }: Context) {
  const { userId } = await auth();
  if (!userId) return jsonError(401, "unauthorized");
  const limited = rateLimited(userId, "canvases"); if (limited) return limited;
  const { id } = await params;
  if (!isCanvasId(id)) return jsonError(404, "not_found");
  const parsed = saveCanvasBodySchema.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(400, "invalid_body", { issues: parsed.error.issues });

  const updated = await saveCanvasIfVersion(userId, id, parsed.data.data, parsed.data.version);
  if (updated) {
    return Response.json({ version: updated.version, updatedAt: toSummary(updated).updatedAt });
  }
  const current = await getCanvasForUser(userId, id);
  if (!current) return jsonError(404, "not_found");
  const decision = decideVersion(current.version, parsed.data.version);
  if (!decision.ok) return Response.json(decision.body, { status: decision.status });
  // Versions matched but the conditional update did not apply: treat as a conflict so the client reloads.
  return Response.json({ error: "version_conflict", version: current.version }, { status: 409 });
}

/** PATCH /api/canvases/:id { title }: rename. */
export async function PATCH(req: Request, { params }: Context) {
  const { userId } = await auth();
  if (!userId) return jsonError(401, "unauthorized");
  const limited = rateLimited(userId, "canvases"); if (limited) return limited;
  const { id } = await params;
  if (!isCanvasId(id)) return jsonError(404, "not_found");
  const parsed = renameCanvasBodySchema.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(400, "invalid_body", { issues: parsed.error.issues });
  const row = await renameCanvasForUser(userId, id, parsed.data.title);
  if (!row) return jsonError(404, "not_found");
  return Response.json(toSummary(row));
}

/** DELETE /api/canvases/:id */
export async function DELETE(_req: Request, { params }: Context) {
  const { userId } = await auth();
  if (!userId) return jsonError(401, "unauthorized");
  const limited = rateLimited(userId, "canvases"); if (limited) return limited;
  const { id } = await params;
  if (!isCanvasId(id)) return jsonError(404, "not_found");
  const deleted = await deleteCanvasForUser(userId, id);
  if (!deleted) return jsonError(404, "not_found");
  return Response.json({ ok: true });
}
