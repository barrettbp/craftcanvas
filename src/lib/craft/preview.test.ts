import { describe, expect, it } from "vitest";

import { needsPreview, stripFrontmatter, titleFromMarkdown, trimPreview } from "./preview";

describe("trimPreview", () => {
  it("strips frontmatter and collapses whitespace", () => {
    const md = "---\ntitle: Hello\ntags: [a, b]\n---\n\n# Hello\n\nFirst   paragraph.\n\n\n- item one\n- item two\n";
    expect(trimPreview(md)).toBe("# Hello First paragraph. - item one - item two");
  });

  it("drops a leading H1 that matches the title", () => {
    const md = "# Research notes\n\nBody text here.";
    expect(trimPreview(md, 600, "research notes")).toBe("Body text here.");
    expect(trimPreview(md, 600, "Other title")).toBe("# Research notes Body text here.");
  });

  it("keeps text under the limit untouched apart from whitespace", () => {
    expect(trimPreview("a\r\nb\r\n\r\nc")).toBe("a b c");
    expect(trimPreview("   ")).toBe("");
  });

  it("cuts at a word boundary near 600 chars and adds an ellipsis", () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const out = trimPreview(words);
    expect(out.length).toBeLessThanOrEqual(601);
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, -1).endsWith(" ")).toBe(false);
    // Never cuts inside a word.
    const lastWord = out.slice(0, -1).split(" ").pop()!;
    expect(words.split(" ")).toContain(lastWord);
  });

  it("cuts hard when there is no reasonable word boundary", () => {
    const out = trimPreview("x".repeat(1000), 100);
    expect(out).toBe(`${"x".repeat(100)}…`);
  });

  it("does not treat a later --- as frontmatter", () => {
    const md = "Intro\n---\nkey: value\n---\nmore";
    expect(trimPreview(md)).toBe("Intro --- key: value --- more");
  });

  it("handles a BOM and leading blank lines before frontmatter", () => {
    expect(stripFrontmatter("﻿\n\n---\na: 1\n---\nbody")).toBe("body");
  });
});

describe("titleFromMarkdown", () => {
  it("returns the first H1", () => {
    expect(titleFromMarkdown("---\nx: 1\n---\n\n# My doc\ntext")).toBe("My doc");
    expect(titleFromMarkdown("no heading")).toBeUndefined();
  });
});

describe("needsPreview", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const fresh = { preview: "p", indexedAt: new Date("2026-10-08T11:00:00Z"), updatedAt: new Date("2026-10-01T00:00:00Z"), missing: false };

  it("fetches when there is no row, no preview, or the row is missing", () => {
    expect(needsPreview({ existing: null, now })).toBe(true);
    expect(needsPreview({ existing: { ...fresh, preview: null }, now })).toBe(true);
    expect(needsPreview({ existing: { ...fresh, missing: true }, now })).toBe(true);
    expect(needsPreview({ existing: { ...fresh, indexedAt: null }, now })).toBe(true);
  });

  it("skips a fresh row without a newer update", () => {
    expect(needsPreview({ existing: fresh, now })).toBe(false);
    expect(needsPreview({ existing: fresh, incomingUpdatedAt: "2026-09-30T00:00:00Z", now })).toBe(false);
  });

  it("fetches when Craft reports a newer update", () => {
    expect(needsPreview({ existing: fresh, incomingUpdatedAt: "2026-10-05T00:00:00Z", now })).toBe(true);
    expect(needsPreview({ existing: { ...fresh, updatedAt: null }, incomingUpdatedAt: "2026-10-05T00:00:00Z", now })).toBe(true);
  });

  it("fetches when the preview is older than the max age", () => {
    const old = { ...fresh, indexedAt: new Date("2026-10-06T00:00:00Z") };
    expect(needsPreview({ existing: old, now })).toBe(true);
    expect(needsPreview({ existing: old, now, maxAgeMs: 10 * 24 * 60 * 60 * 1000 })).toBe(false);
  });
});
