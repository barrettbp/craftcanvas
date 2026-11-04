import { Hono } from "hono";
import type { AppEnv } from "../env";
import { craftMode } from "../env";
import { checkPassword, clearSession, clientIp, hasSession, loginThrottled, resetLoginThrottle, sessionSecret, setSession } from "../auth";

export const auth = new Hono<AppEnv>();

auth.post("/auth/login", async (c) => {
  if (!c.env.APP_PASSWORD || !sessionSecret(c.env)) {
    return c.json({ error: "not_configured", message: "APP_PASSWORD and SESSION_SECRET must be set." }, 500);
  }
  const ip = clientIp(c);
  if (loginThrottled(ip)) return c.json({ error: "rate_limited", message: "Too many attempts. Try again in a minute." }, 429);

  let password: unknown;
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("application/json")) {
    password = ((await c.req.json().catch(() => ({}))) as Record<string, unknown>).password;
  } else {
    password = ((await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>).password;
  }
  if (!checkPassword(c.env, password)) return c.json({ error: "unauthorized", message: "Wrong password." }, 401);

  resetLoginThrottle(ip);
  await setSession(c);
  return c.json({ ok: true });
});

auth.post("/auth/logout", (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

auth.get("/auth/me", async (c) => {
  if (!(await hasSession(c))) return c.json({ error: "unauthorized" }, 401);
  return c.json({ ok: true, mode: craftMode(c.env) });
});
