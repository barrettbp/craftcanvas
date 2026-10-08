import { describe, expect, it } from "vitest";

import { extractSpaceId, normaliseDocument, normaliseDocuments, normaliseFolders, normaliseMarkdown, unwrapList } from "./normalise";

describe("unwrapList", () => {
  it("accepts arrays and common wrappers", () => {
    expect(unwrapList([{ a: 1 }, "x", null])).toEqual([{ a: 1 }]);
    expect(unwrapList({ folders: [{ id: 1 }] }, ["folders"])).toEqual([{ id: 1 }]);
    expect(unwrapList({ items: [{ id: 1 }] })).toEqual([{ id: 1 }]);
    expect(unwrapList({ data: { documents: [{ id: 1 }] } }, ["documents"])).toEqual([{ id: 1 }]);
    expect(unwrapList({ nothing: true })).toEqual([]);
    expect(unwrapList(null)).toEqual([]);
  });
});

describe("normaliseFolders", () => {
  it("supports nested children and de-duplicates", () => {
    const folders = normaliseFolders({
      folders: [
        { id: "root", name: "Root", children: [{ id: "child", name: "Child" }] },
        { id: "child", name: "Child", parentId: "root" },
      ],
    });
    expect(folders).toEqual([
      { id: "root", name: "Root", parentId: undefined, path: "Root" },
      { id: "child", name: "Child", parentId: "root", path: "Root/Child" },
    ]);
  });

  it("uses a provided path and ignores unknown or self parents", () => {
    const folders = normaliseFolders([
      { id: "a", name: "A", path: "/Custom/Path/" },
      { id: "b", name: "B", parentId: "ghost" },
      { id: "c", name: "C", parentId: "c" },
      { name: "no id" },
    ]);
    expect(folders).toEqual([
      { id: "a", name: "A", parentId: undefined, path: "Custom/Path" },
      { id: "b", name: "B", parentId: undefined, path: "B" },
      { id: "c", name: "C", parentId: undefined, path: "C" },
    ]);
  });

  it("survives parent cycles", () => {
    const folders = normaliseFolders([
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ]);
    expect(folders).toHaveLength(2);
    for (const f of folders) {
      expect(f.path.length).toBeGreaterThan(0);
      expect(f.path.split("/").length).toBeLessThanOrEqual(2);
    }
  });
});

describe("normaliseDocument", () => {
  it("fills folder info from context and parses epoch timestamps", () => {
    const doc = normaliseDocument({ id: "d", title: "T", modifiedAt: 1700000000000 }, { folderId: "f", folderPathById: new Map([["f", "P"]]) });
    expect(doc).toEqual({ id: "d", title: "T", folderId: "f", folderPath: "P", updatedAt: "2023-11-14T22:13:20.000Z", webUrl: undefined });
  });

  it("reads a nested folder object and rejects non http urls", () => {
    const doc = normaliseDocument({ documentId: "d", name: "N", folder: { id: "f", path: "/X/Y" }, link: "craftdocs://open" });
    expect(doc).toEqual({ id: "d", title: "N", folderId: "f", folderPath: "X/Y", updatedAt: undefined, webUrl: undefined });
  });

  it("returns undefined without an id and falls back to Untitled", () => {
    expect(normaliseDocument({ title: "x" })).toBeUndefined();
    expect(normaliseDocument("nope")).toBeUndefined();
    expect(normaliseDocument({ id: 5 })?.title).toBe("Untitled");
  });

  it("de-duplicates document lists", () => {
    expect(normaliseDocuments({ documents: [{ id: "a" }, { id: "a" }, { id: "b" }] }).map((d) => d.id)).toEqual(["a", "b"]);
  });
});

describe("normaliseMarkdown", () => {
  it("returns plain markdown untouched", () => {
    expect(normaliseMarkdown("# Hi\n\n- a", "text/markdown; charset=utf-8")).toBe("# Hi\n\n- a");
  });

  it("extracts strings from JSON bodies", () => {
    expect(normaliseMarkdown(JSON.stringify({ markdown: "# A" }), "application/json")).toBe("# A");
    expect(normaliseMarkdown(JSON.stringify("raw"), "application/json")).toBe("raw");
    expect(normaliseMarkdown(JSON.stringify({ blocks: [{ text: "a" }, { markdown: "b" }] }), null)).toBe("a\n\nb");
  });

  it("falls back to the body when JSON is invalid", () => {
    expect(normaliseMarkdown("{not json", "application/json")).toBe("{not json");
  });
});

describe("extractSpaceId", () => {
  it("finds a space id at the top level or nested", () => {
    expect(extractSpaceId({ spaceId: "s1" })).toBe("s1");
    expect(extractSpaceId({ space: { id: "s2" } })).toBe("s2");
    expect(extractSpaceId([])).toBeUndefined();
  });
});
