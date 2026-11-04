import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv, Bindings } from "./env";
import { b64url, timingSafeEqual } from "./util";

export const SESSION_COOKIE = "cc_session";
const SESSION_TTL_S = 60 * 60 * 24 * 14; // 14 days

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64url(sig);
}

/** Token format: <expiresUnixSeconds>.<nonce>.<signature> */
export async function createSessionToken(secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `${exp}.${nonce}`;
  return `${payload}.${await sign(secret, payload)}`;
}

export async function verifySessionToken(secret: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expStr, nonce, sig] = parts;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = await sign(secret, `${expStr}.${nonce}`);
  return timingSafeEqual(expected, sig);
}

export function sessionSecret(env: Bindings): string | null {
  const s = env.SESSION_SECRET;
  if (!s || s.length < 16) return null;
  return s;
}

export async function hasSession(c: Context<AppEnv>): Promise<boolean> {
  const secret = sessionSecret(c.env);
  if (!secret) return false;
  return verifySessionToken(secret, getCookie(c, SESSION_COOKIE));
}

export async function setSession(c: Context<AppEnv>): Promise<void> {
  const secret = sessionSecret(c.env);
  if (!secret) throw new Error("SESSION_SECRET missing");
  const token = await createSessionToken(secret);
  const secure = new URL(c.req.url).protocol === "https:";
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
}

export function clearSession(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Per-isolate login throttle: 5 attempts per minute per client IP. Best effort (isolates are not shared). */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;

export function clientIp(c: Context<AppEnv>): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export function loginThrottled(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    if (attempts.size > 5000) attempts.clear();
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

export function resetLoginThrottle(ip: string): void {
  attempts.delete(ip);
}

export function checkPassword(env: Bindings, given: unknown): boolean {
  const expected = env.APP_PASSWORD;
  if (!expected || typeof given !== "string") return false;
  return timingSafeEqual(expected, given);
}

/** Protects /api/* (except login). */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!(await hasSession(c))) {
    return c.json({ error: "unauthorized", message: "Sign in first." }, 401);
  }
  await next();
};
