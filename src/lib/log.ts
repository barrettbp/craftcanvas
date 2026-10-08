/**
 * Structured logger: one JSON line per call, with every string (the message
 * and every nested field, including object keys) scrubbed of Craft API keys.
 * A `pdk_…` token is replaced with `pdk_[redacted]` before anything is
 * serialised, so a key that sneaks into an error message, a URL echoed by
 * undici or a request body can never reach the log sink (spec section 11).
 *
 *   log.info("craft.request", { method: "GET", path: "/folders", latencyMs: 120 });
 *   log.error("api/craft/connect failed", { err });
 *
 * Errors are flattened to `{ name, message, stack }`; cycles and deep nesting
 * are cut rather than thrown on. Nothing here reads env or throws at import.
 */

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const KEY_RE = /pdk_[A-Za-z0-9_-]+/g;
const MAX_DEPTH = 6;

/** Replaces every `pdk_…` token in a string with `pdk_[redacted]`. */
export function redactString(text: string): string {
  return text.replace(KEY_RE, "pdk_[redacted]");
}

/**
 * Deep copies a value with every string redacted. Errors become plain
 * objects, dates become ISO strings, cycles become "[circular]" and anything
 * deeper than six levels becomes "[truncated]".
 */
export function redact(value: unknown, depth = 0, ancestors: object[] = []): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return value.toString();
    return value;
  }
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (ancestors.includes(value)) return "[circular]";
  const next = [...ancestors, value];

  if (value instanceof Error) {
    const out: Record<string, unknown> = { name: value.name, message: redactString(value.message) };
    if (value.stack) out.stack = redactString(value.stack);
    if ("cause" in value && value.cause !== undefined) out.cause = redact(value.cause, depth + 1, next);
    return out;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, next));
  if (value instanceof Map) return redact(Object.fromEntries(value), depth + 1, next);
  if (value instanceof Set) return redact([...value], depth + 1, next);

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[redactString(key)] = redact(item, depth + 1, next);
  return out;
}

/** Builds the JSON line. Pure, so tests can check the exact output. */
export function formatLogLine(level: LogLevel, message: string, fields?: LogFields, time: Date = new Date()): string {
  const record: Record<string, unknown> = { level, time: time.toISOString(), msg: redactString(message) };
  if (fields) {
    const safe = redact(fields) as Record<string, unknown>;
    for (const [key, value] of Object.entries(safe)) {
      if (key === "level" || key === "time" || key === "msg") record[`field_${key}`] = value;
      else record[key] = value;
    }
  }
  try {
    return JSON.stringify(record);
  } catch {
    return JSON.stringify({ level, time: time.toISOString(), msg: redactString(message), fields: "[unserialisable]" });
  }
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  const line = formatLogLine(level, message, fields);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const log = {
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  error: (message: string, fields?: LogFields) => emit("error", message, fields),
} as const;

export default log;
