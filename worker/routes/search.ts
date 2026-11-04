import { Hono } from "hono";
import type { AppEnv } from "../env";
import { clampInt } from "../util";
import { search as runSearch } from "../search";
import type { SearchKind } from "../../shared/types";

const KINDS: SearchKind[] = ["note", "object", "pdf_page"];

export const searchRoute = new Hono<AppEnv>();

searchRoute.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ results: [] });
  const limit = clampInt(c.req.query("limit"), 20, 1, 100);
  const kinds = (c.req.query("kinds") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k): k is SearchKind => KINDS.includes(k as SearchKind));
  return c.json({ results: await runSearch(c.env.DB, q, { limit, kinds }) });
});
