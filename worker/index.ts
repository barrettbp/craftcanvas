import { Hono } from "hono";
import type { AppEnv } from "./env";
import { hasSession, requireSession } from "./auth";
import { auth } from "./routes/auth";
import { notes } from "./routes/notes";
import { boards } from "./routes/boards";
import { sync } from "./routes/sync";
import loginHtml from "./login.html?raw";

const app = new Hono<AppEnv>();

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
api.all("*", (c) => c.json({ error: "not_found" }, 404));
app.route("/api", api);

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
