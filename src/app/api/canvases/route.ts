import { auth } from "@clerk/nextjs/server";

import { createCanvasBodySchema, DEFAULT_TITLE, jsonError, readJson, toSummary } from "@/lib/canvas/api";
import { createCanvasForUser, listCanvasesForUser } from "@/lib/canvas/repo";
import { emptyCanvas } from "@/lib/canvas/schema";
import { rateLimited } from "@/lib/rate-limit";

/** GET /api/canvases: the user's canvases, newest first (no `data`). */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return jsonError(401, "unauthorized");
  const limited = rateLimited(userId, "canvases"); if (limited) return limited;
  const rows = await listCanvasesForUser(userId);
  return Response.json({ canvases: rows.map(toSummary) });
}

/** POST /api/canvases { title?, data? }: creates a canvas. */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError(401, "unauthorized");
  const limited = rateLimited(userId, "canvases"); if (limited) return limited;
  const parsed = createCanvasBodySchema.safeParse((await readJson(req)) ?? {});
  if (!parsed.success) return jsonError(400, "invalid_body", { issues: parsed.error.issues });
  const row = await createCanvasForUser(userId, parsed.data.title ?? DEFAULT_TITLE, parsed.data.data ?? emptyCanvas());
  return Response.json(toSummary(row), { status: 201 });
}
