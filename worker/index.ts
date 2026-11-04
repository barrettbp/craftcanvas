import { Hono, type Context } from "hono";
import type { AppEnv } from "./env";
import { hasSession, requireSession } from "./auth";
import { auth } from "./routes/auth";
import { notes } from "./routes/notes";
import { boards } from "./routes/boards";
import { sync } from "./routes/sync";
import { objects } from "./routes/objects";
import { arrows } from "./routes/arrows";
import { assets } from "./routes/assets";
import { searchRoute } from "./routes/search";
import { handleMcp } from "./mcp";
import { timingSafeEqual } from "./util";
import loginHtml from "./login.html?raw";

const app = new Hono<AppEnv>();

// Unexpected errors become JSON and never echo URLs (the Craft connection URL is a credential).
app.onError((err, c) => {
  const message = (err instanceof Error ? err.message : "error").replace(/https?:\/\/\S+/g, "[url]").slice(0, 300);
  return c.json({ error: "internal", message }, 500);
});

// Private tool: never indexed, never cached by intermediaries.
app.use("*", async (c, next) => {
  await next();
  // Responses from the ASSETS binding carry immutable headers; re-wrap before adding ours.
  c.res = new Response(c.res.body, c.res);
  c.res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  c.res.headers.set("Cache-Control", "no-store");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("Referrer-Policy", "no-referrer");
  c.res.headers.set("X-Frame-Options", "DENY");
});

// ---- API ----
const api = new Hono<AppEnv>();
api.route("/", auth);
api.use("*", requireSession);
api.route("/", notes);
api.route("/", boards);
api.route("/", sync);
api.route("/", objects);
api.route("/", arrows);
api.route("/", assets);
api.route("/", searchRoute);
api.all("*", (c) => c.json({ error: "not_found" }, 404));
app.route("/api", api);

// ---- MCP (read-only). Token via `Authorization: Bearer` on /mcp, or as the path segment /mcp/<token>. ----
function mcpAuthorized(expected: string | undefined, header: string | undefined, pathToken: string | undefined): boolean {
  if (!expected || expected.length < 16) return false;
  const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer && timingSafeEqual(expected, bearer)) return true;
  if (pathToken && timingSafeEqual(expected, pathToken)) return true;
  return false;
}
const mcpHandler = async (c: Context<AppEnv>) => {
  const pathToken = (c.req.param() as Record<string, string | undefined>).token;
  if (!mcpAuthorized(c.env.MCP_TOKEN, c.req.header("authorization"), pathToken)) {
    return c.json({ error: "unauthorized", message: "MCP token required." }, 401, { "WWW-Authenticate": "Bearer" });
  }
  if (c.req.method === "GET" || c.req.method === "DELETE") return c.json({ error: "method_not_allowed", message: "Stateless server: use POST." }, 405);
  if (c.req.method !== "POST") return c.json({ error: "method_not_allowed" }, 405);
  return handleMcp(c.env, c.req.raw);
};
app.all("/mcp", mcpHandler);
app.all("/mcp/:token", mcpHandler);

// ---- Pages and assets: gated by the session cookie ----
app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));

app.all("*", async (c) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.json({ error: "method_not_allowed" }, 405);
  if (!(await hasSession(c))) {
    return c.html(loginHtml, 401);
  }
  if (new URL(c.req.url).pathname === "/login") return c.redirect("/");
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
