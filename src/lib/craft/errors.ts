/**
 * Typed errors thrown by the Craft client, connection loader and indexer.
 * Route handlers map these to HTTP responses in `api.ts`.
 */

export class CraftError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "CraftError";
    this.status = status;
  }
}

/** Craft answered 401 or 403: the key was revoked or is wrong. */
export class CraftUnauthorizedError extends CraftError {
  constructor(message = "Craft rejected the API key") {
    super(message, 401);
    this.name = "CraftUnauthorizedError";
  }
}

/** Craft answered 404: the document (or folder) no longer exists or is not in the connection. */
export class CraftNotFoundError extends CraftError {
  constructor(message = "Not found in Craft") {
    super(message, 404);
    this.name = "CraftNotFoundError";
  }
}

/** Craft kept answering 429 after all retries. */
export class CraftRateLimitedError extends CraftError {
  readonly retryAfterSeconds?: number;

  constructor(retryAfterSeconds?: number, message = "Craft rate limit hit") {
    super(message, 429);
    this.name = "CraftRateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Craft kept answering 5xx after all retries. */
export class CraftServerError extends CraftError {
  constructor(status: number, message = `Craft responded with ${status}`) {
    super(message, status);
    this.name = "CraftServerError";
  }
}

/** Any other non 2xx response (400, 422, ...). */
export class CraftRequestError extends CraftError {
  constructor(status: number, message = `Craft responded with ${status}`) {
    super(message, status);
    this.name = "CraftRequestError";
  }
}

/** The request did not finish within the timeout. */
export class CraftTimeoutError extends CraftError {
  constructor(timeoutMs: number) {
    super(`Craft request timed out after ${timeoutMs}ms`);
    this.name = "CraftTimeoutError";
  }
}

/** `fetch` itself failed (DNS, TLS, connection reset). */
export class CraftNetworkError extends CraftError {
  constructor(message = "Could not reach Craft") {
    super(message);
    this.name = "CraftNetworkError";
  }
}

/** The user has no `craft_connections` row. */
export class CraftNotConnectedError extends Error {
  constructor() {
    super("No Craft connection for this user");
    this.name = "CraftNotConnectedError";
  }
}

/** A full refresh was requested less than a minute after the last one. */
export class RefreshRateLimitedError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`Full refresh already ran recently, retry in ${retryAfterSeconds}s`);
    this.name = "RefreshRateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
