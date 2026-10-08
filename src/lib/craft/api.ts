/**
 * Helpers shared by the `/api/craft/*` route handlers: Clerk auth and the
 * mapping from typed Craft errors to HTTP responses.
 *
 * Error vocabulary (`{ error: string }` bodies):
 *   401 unauthenticated        no Clerk session
 *   400 invalid_request        zod validation failed (`issues` lists them)
 *   404 not_connected          the user has no Craft connection
 *   404 not_found              Craft answered 404
 *   403 craft_unauthorized     Craft rejected the key (connection flagged)
 *   429 craft_rate_limited     Craft kept answering 429 (`Retry-After` set)
 *   429 refresh_rate_limited   full refresh requested within a minute (`Retry-After` set)
 *   502 craft_unavailable      timeout, network error or 5xx after retries
 *   502 craft_error            any other Craft response we could not use
 *   500 internal_error         anything else
 */
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { ZodError } from "zod";

import { DecryptError } from "@/lib/crypto/aes";
import { MissingEnvError } from "@/lib/env";

import {
  CraftError,
  CraftNetworkError,
  CraftNotConnectedError,
  CraftNotFoundError,
  CraftRateLimitedError,
  CraftServerError,
  CraftTimeoutError,
  CraftUnauthorizedError,
  RefreshRateLimitedError,
} from "./errors";

export type ApiError = { error: string; message?: string; retryAfter?: number; issues?: Array<{ path: string; message: string }> };

export function json<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init);
}

export function errorResponse(status: number, error: string, extra: Omit<ApiError, "error"> = {}, headers?: HeadersInit): NextResponse<ApiError> {
  return NextResponse.json({ error, ...extra }, { status, headers });
}

/** Returns the Clerk userId, or `null` when signed out (routes answer 401). */
export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session.userId ?? null;
}

export function unauthenticated(): NextResponse<ApiError> {
  return errorResponse(401, "unauthenticated");
}

export function invalidRequest(error: ZodError): NextResponse<ApiError> {
  return errorResponse(400, "invalid_request", {
    issues: error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
  });
}

/** Maps a thrown error to a response. Never includes stack traces or the key. */
export function craftErrorResponse(err: unknown, context = "api/craft"): NextResponse<ApiError> {
  if (err instanceof CraftNotConnectedError) return errorResponse(404, "not_connected");
  if (err instanceof RefreshRateLimitedError) {
    return errorResponse(429, "refresh_rate_limited", { retryAfter: err.retryAfterSeconds }, { "Retry-After": String(err.retryAfterSeconds) });
  }
  if (err instanceof CraftUnauthorizedError) return errorResponse(403, "craft_unauthorized", { message: "Craft rejected the API key. Reconnect from Settings." });
  if (err instanceof CraftNotFoundError) return errorResponse(404, "not_found");
  if (err instanceof CraftRateLimitedError) {
    const retryAfter = err.retryAfterSeconds ?? 30;
    return errorResponse(429, "craft_rate_limited", { retryAfter }, { "Retry-After": String(retryAfter) });
  }
  if (err instanceof CraftTimeoutError || err instanceof CraftNetworkError || err instanceof CraftServerError) {
    return errorResponse(502, "craft_unavailable", { message: "Craft did not answer in time. Try again in a moment." });
  }
  if (err instanceof CraftError) return errorResponse(502, "craft_error", { message: err.message });
  if (err instanceof DecryptError || err instanceof MissingEnvError) {
    console.error(`[${context}] configuration error:`, err.name);
    return errorResponse(500, "server_misconfigured");
  }
  console.error(`[${context}] unexpected error:`, err instanceof Error ? `${err.name}: ${err.message}` : err);
  return errorResponse(500, "internal_error");
}
