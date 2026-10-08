import { afterEach, describe, expect, it, vi } from "vitest";

import { formatLogLine, log, redact, redactString } from "./log";

const KEY = "pdk_AbC123-xyz_789";

describe("redaction", () => {
  it("masks every pdk_ token in a string", () => {
    expect(redactString(`Bearer ${KEY} and ${KEY}`)).toBe("Bearer pdk_[redacted] and pdk_[redacted]");
    expect(redactString("no key here")).toBe("no key here");
  });

  it("masks strings nested in objects, arrays, maps, sets and object keys", () => {
    const value = {
      url: `https://x.test/?k=${KEY}`,
      list: [KEY, { deeper: [{ deepest: KEY }] }],
      map: new Map([[KEY, KEY]]),
      set: new Set([KEY]),
      [KEY]: "value",
      count: 3,
      flag: true,
      nothing: null,
    };
    const out = JSON.stringify(redact(value));
    expect(out).not.toContain(KEY);
    expect(out).toContain("pdk_[redacted]");
    expect(redact(value)).toMatchObject({ count: 3, flag: true, nothing: null, "pdk_[redacted]": "value" });
  });

  it("flattens errors and redacts their message, stack and cause", () => {
    const err = new Error(`request to ${KEY} failed`, { cause: new Error(`inner ${KEY}`) });
    const out = redact(err) as { name: string; message: string; stack?: string; cause: { message: string } };
    expect(out.name).toBe("Error");
    expect(out.message).toBe("request to pdk_[redacted] failed");
    expect(out.cause.message).toBe("inner pdk_[redacted]");
    expect(JSON.stringify(out)).not.toContain(KEY);
  });

  it("survives cycles and deep nesting", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(redact(a)).toEqual({ name: "a", self: "[circular]" });
    let deep: Record<string, unknown> = { leaf: KEY };
    for (let i = 0; i < 10; i += 1) deep = { child: deep };
    expect(JSON.stringify(redact(deep))).not.toContain(KEY);
    expect(JSON.stringify(redact(deep))).toContain("[truncated]");
  });
});

describe("formatLogLine", () => {
  it("produces one valid JSON line with level, time, msg and redacted fields", () => {
    const time = new Date("2026-10-08T12:00:00.000Z");
    const line = formatLogLine("warn", `key ${KEY} leaked`, { path: `/x?${KEY}`, attempt: 2 }, time);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({
      level: "warn",
      time: "2026-10-08T12:00:00.000Z",
      msg: "key pdk_[redacted] leaked",
      path: "/x?pdk_[redacted]",
      attempt: 2,
    });
  });

  it("does not let fields overwrite the reserved keys", () => {
    const parsed = JSON.parse(formatLogLine("info", "hello", { level: "error", msg: "nope" }));
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("hello");
    expect(parsed.field_level).toBe("error");
  });

  it("falls back when a field cannot be serialised", () => {
    const parsed = JSON.parse(formatLogLine("info", "big", { n: BigInt(1) }));
    expect(parsed.n).toBe("1");
  });
});

describe("log", () => {
  afterEach(() => vi.restoreAllMocks());

  it("routes levels to console.info / warn / error with redacted lines", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    log.info("i", { k: KEY });
    log.warn("w", { k: KEY });
    log.error("e", { err: new Error(KEY) });

    for (const spy of [info, warn, error]) {
      expect(spy).toHaveBeenCalledTimes(1);
      const line = spy.mock.calls[0][0] as string;
      expect(line).not.toContain(KEY);
      expect(() => JSON.parse(line)).not.toThrow();
    }
    expect(JSON.parse(info.mock.calls[0][0] as string).level).toBe("info");
    expect(JSON.parse(error.mock.calls[0][0] as string).err.message).toBe("pdk_[redacted]");
  });
});
