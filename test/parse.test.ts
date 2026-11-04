import { describe, expect, it } from "vitest";
import {
  blocksToMarkdown,
  cleanMarkdown,
  deepLinks,
  extractLinks,
  flattenFolders,
  makePreview,
  normalizeDocumentRef,
  normalizeTitle,
  titleFromMarkdown,
} from "../worker/craft/parse";

describe("extractLinks", () => {
  it("finds block:// links and out-of-scope targets, deduplicating block ids", () => {
    const md = `See [A](block://abc-1) and [again A](block://abc-1), then [B](block://b2) and [hidden](invalid:out_of_scope) and [h2](invalid:out_of_scope).`;
    const links = extractLinks(md);
    expect(links).toEqual([
      { targetBlockId: "abc-1", label: "A", outOfScope: false },
      { targetBlockId: "b2", label: "B", outOfScope: false },
      { targetBlockId: "out_of_scope:1", label: "hidden", outOfScope: true },
      { targetBlockId: "out_of_scope:2", label: "h2", outOfScope: true },
    ]);
  });

  it("ignores http and date links", () => {
    expect(extractLinks("[x](https://example.com) [d](date://2026-11-04)")).toEqual([]);
  });
});

describe("markdown helpers", () => {
  const md = `<page><pageTitle>My Title</pageTitle><content>\nFirst line with [link](block://x).\n\n\n**Bold** text\n</content></page>`;
  it("cleans Craft wrapper tags into plain markdown", () => {
    const out = cleanMarkdown(md);
    expect(out.startsWith("# My Title")).toBe(true);
    expect(out).not.toContain("<page>");
    expect(out).not.toContain("</content>");
  });
  it("makes a preview without the title or markup", () => {
    expect(makePreview(md)).toBe("First line with link. Bold text");
  });
  it("drops images and keeps link text in previews", () => {
    expect(makePreview("![](https://r.craft.do/x)\nSee [the doc](block://a) and ![alt](https://img) now **bold**")).toBe("See the doc and now bold");
  });
  it("cuts long previews", () => {
    const long = "word ".repeat(200);
    const p = makePreview(long, 50);
    expect(p.length).toBeLessThanOrEqual(50);
    expect(p.endsWith("…")).toBe(true);
  });
  it("finds the title from tag, heading or first line", () => {
    expect(titleFromMarkdown(md)).toBe("My Title");
    expect(titleFromMarkdown("# Heading\nbody")).toBe("Heading");
    expect(titleFromMarkdown("just text\nmore")).toBe("just text");
    expect(titleFromMarkdown("")).toBeNull();
  });
});

describe("deepLinks", () => {
  it("builds app and web links from a space id", () => {
    expect(deepLinks("S1", "D1")).toEqual({
      app: "craftdocs://open?spaceId=S1&documentId=D1",
      web: "https://docs.craft.do/editor/d/S1/D1",
    });
  });
  it("prefers a clickableLink from Craft for the app link", () => {
    expect(deepLinks("S1", "D1", "craftdocs://open?spaceId=S1&documentId=D1&blockId=B").app).toContain("blockId=B");
  });
  it("returns empty strings without a space id", () => {
    expect(deepLinks(null, "D1")).toEqual({ app: "", web: "" });
  });
});

describe("normalisers", () => {
  it("accepts string and object titles", () => {
    expect(normalizeTitle("  Hello ")).toBe("Hello");
    expect(normalizeTitle({ text: "Obj" })).toBe("Obj");
    expect(normalizeTitle({ content: [{ text: "A" }, { text: "B" }] })).toBe("AB");
    expect(normalizeTitle(42)).toBe("");
  });
  it("normalises document list items with several id spellings", () => {
    expect(normalizeDocumentRef({ id: "d1", title: "T", folderId: "f" })).toEqual({ id: "d1", title: "T", folderId: "f", folderName: null });
    expect(normalizeDocumentRef({ rootBlockIds: ["r1"], title: { text: "X" } })?.id).toBe("r1");
    expect(normalizeDocumentRef({ documentId: "d2", deleted: true })).toBeNull();
    expect(normalizeDocumentRef({ title: "no id" })).toBeNull();
    expect(normalizeDocumentRef("nope")).toBeNull();
  });
  it("flattens nested folder trees", () => {
    const tree = [{ id: "a", name: "A", subfolders: [{ id: "b", name: "B", subfolders: [] }] }, { id: "c", name: "C" }];
    expect(flattenFolders(tree)).toEqual([
      { id: "a", name: "A", parentId: null },
      { id: "b", name: "B", parentId: "a" },
      { id: "c", name: "C", parentId: null },
    ]);
  });
  it("walks a block tree into markdown and collects block ids", () => {
    const tree = {
      id: "root",
      type: "page",
      title: { text: "Doc" },
      content: [
        { id: "b1", type: "text", markdown: "Hello [x](block://z)", indentationLevel: 0 },
        { id: "b2", type: "text", markdown: "item", listStyle: "bullet", indentationLevel: 1 },
        { id: "p2", type: "page", title: "Sub", content: [{ id: "b3", type: "text", markdown: "deep" }] },
      ],
    };
    const out = blocksToMarkdown(tree);
    expect(out.title).toBe("Doc");
    expect(out.blockIds).toEqual(["root", "b1", "b2", "p2", "b3"]);
    expect(out.markdown).toBe("# Doc\nHello [x](block://z)\n  - item\n## Sub\ndeep");
  });
});
