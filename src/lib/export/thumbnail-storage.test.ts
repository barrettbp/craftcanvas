import { describe, expect, it } from "vitest";

import { dataUrlByteLength, decideThumbnailStorage, parsePngDataUrl, THUMBNAIL_MAX_BYTES, thumbnailBodySchema } from "./thumbnail-storage";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64").length;

describe("decideThumbnailStorage", () => {
  const input = { bucket: "thumbnails", userId: "user_1", canvasId: "c-1" };

  it("uses Supabase Storage at <userId>/<canvasId>.png when configured", () => {
    expect(decideThumbnailStorage({ ...input, hasSupabase: true })).toEqual({
      kind: "supabase",
      bucket: "thumbnails",
      path: "user_1/c-1.png",
    });
  });

  it("falls back to an inline data URL without Supabase or without a bucket name", () => {
    expect(decideThumbnailStorage({ ...input, hasSupabase: false })).toEqual({ kind: "inline" });
    expect(decideThumbnailStorage({ ...input, hasSupabase: true, bucket: "  " })).toEqual({ kind: "inline" });
  });
});

describe("parsePngDataUrl", () => {
  it("accepts a real PNG data URL and reports its decoded size", () => {
    const result = parsePngDataUrl(PNG_DATA_URL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.png.bytes).toBe(PNG_BYTES);
      expect(result.png.base64.startsWith("iVBORw0KGgo")).toBe(true);
    }
  });

  it("rejects other mime types, non data URLs and bad base64", () => {
    expect(parsePngDataUrl("data:image/jpeg;base64,/9j/4AAQ")).toEqual({ ok: false, reason: "not_png_data_url" });
    expect(parsePngDataUrl("https://example.com/x.png")).toEqual({ ok: false, reason: "not_png_data_url" });
    expect(parsePngDataUrl("data:image/png;base64,not base64!")).toEqual({ ok: false, reason: "not_png_data_url" });
    expect(parsePngDataUrl("data:image/png;base64,abc")).toEqual({ ok: false, reason: "not_png_data_url" });
  });

  it("rejects payloads without the PNG signature", () => {
    // "hello world this is not a png"
    expect(parsePngDataUrl("data:image/png;base64,aGVsbG8gd29ybGQgdGhpcyBpcyBub3QgYSBwbmc=")).toEqual({ ok: false, reason: "bad_signature" });
    expect(parsePngDataUrl("data:image/png;base64,iVBO")).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects images over the size cap", () => {
    const chars = Math.ceil(((THUMBNAIL_MAX_BYTES + 3) * 4) / 3 / 4) * 4;
    const big = `data:image/png;base64,iVBORw0KGgo${"A".repeat(chars - 11)}`;
    expect(parsePngDataUrl(big)).toEqual({ ok: false, reason: "too_large" });
    expect(parsePngDataUrl(PNG_DATA_URL, 10)).toEqual({ ok: false, reason: "too_large" });
  });
});

describe("dataUrlByteLength", () => {
  it("computes the decoded size from the base64 length", () => {
    expect(dataUrlByteLength(PNG_DATA_URL)).toBe(PNG_BYTES);
    expect(dataUrlByteLength("data:text/plain;base64,aGk=")).toBe(2);
    expect(dataUrlByteLength("data:text/plain;base64,aGk")).toBeNull();
    expect(dataUrlByteLength("data:text/plain,hi")).toBeNull();
    expect(dataUrlByteLength("hi")).toBeNull();
  });
});

describe("thumbnailBodySchema", () => {
  it("requires a non empty dataUrl string of bounded length", () => {
    expect(thumbnailBodySchema.safeParse({ dataUrl: PNG_DATA_URL }).success).toBe(true);
    expect(thumbnailBodySchema.safeParse({}).success).toBe(false);
    expect(thumbnailBodySchema.safeParse({ dataUrl: "" }).success).toBe(false);
    expect(thumbnailBodySchema.safeParse({ dataUrl: "x".repeat(2 * THUMBNAIL_MAX_BYTES) }).success).toBe(false);
  });
});
