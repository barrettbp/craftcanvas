/**
 * GET /api/craft/folders
 *   200 { folders: CraftFolder[] }   (CraftFolder = { id, name, parentId?, path })
 */
import { craftErrorResponse, currentUserId, json, unauthenticated } from "@/lib/craft/api";
import { withCraft } from "@/lib/craft/connection";
import type { CraftFolder } from "@/lib/craft/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return unauthenticated();

  try {
    const folders = await withCraft(userId, ({ client }) => client.listFolders());
    return json<{ folders: CraftFolder[] }>({ folders });
  } catch (err) {
    return craftErrorResponse(err, "api/craft/folders");
  }
}
