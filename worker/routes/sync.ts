import { Hono } from "hono";
import type { AppEnv } from "../env";
import { craftMode } from "../env";
import { makeSource } from "../craft/source";
import { CraftApiError } from "../craft/client";
import { runSyncStep, SyncError, syncStatus } from "../sync";

export const sync = new Hono<AppEnv>();

sync.get("/sync/status", async (c) => c.json(await syncStatus(c.env, craftMode(c.env))));

sync.post("/sync", async (c) => {
  const body = ((await c.req.json().catch(() => ({}))) as Record<string, unknown>) ?? {};
  const cursor = typeof body.cursor === "string" && body.cursor !== "" ? body.cursor : null;
  try {
    const source = makeSource(c.env);
    return c.json(await runSyncStep(c.env, source, cursor));
  } catch (e) {
    if (e instanceof SyncError) return c.json({ error: e.code, message: e.message }, 400);
    if (e instanceof CraftApiError) {
      // Never echo the request URL (it would contain the connection credential).
      const status = e.status === 429 ? 429 : 502;
      return c.json({ error: "craft_api", message: `Craft API returned ${e.status} on ${e.path}.` }, status);
    }
    const msg = e instanceof Error ? e.message : "sync failed";
    return c.json({ error: "sync_failed", message: msg.replace(/https?:\/\/\S+/g, "[url]") }, 500);
  }
});
