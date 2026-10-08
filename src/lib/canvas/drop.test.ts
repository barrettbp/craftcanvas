import { describe, expect, it } from "vitest";

import { CRAFT_DOC_DRAG_TYPE } from "@/lib/craft/types";

import { cardOriginAt, docToFileExtension, hasDocDrag, parseDocDrop, rectCentre } from "./drop";
import { DEFAULT_SIZES } from "./types";

function transfer(data: Record<string, string>) {
  return { types: Object.keys(data), getData: (type: string) => data[type] ?? "" };
}

describe("drop helpers", () => {
  it("recognises the notes panel drag type", () => {
    expect(hasDocDrag(transfer({ [CRAFT_DOC_DRAG_TYPE]: "{}" }))).toBe(true);
    expect(hasDocDrag(transfer({ "text/plain": "x" }))).toBe(false);
    expect(hasDocDrag(null)).toBe(false);
    expect(hasDocDrag({ types: new Set([CRAFT_DOC_DRAG_TYPE]) })).toBe(true);
  });

  it("parses a valid payload and rejects malformed ones", () => {
    const payload = { craftDocId: "d1", title: "Roadmap", folderPath: "Projects" };
    expect(parseDocDrop(transfer({ [CRAFT_DOC_DRAG_TYPE]: JSON.stringify(payload) }))).toEqual(payload);
    expect(parseDocDrop(transfer({ [CRAFT_DOC_DRAG_TYPE]: JSON.stringify({ craftDocId: "d2" }) }))).toEqual({ craftDocId: "d2", title: "", folderPath: "" });
    expect(parseDocDrop(transfer({ [CRAFT_DOC_DRAG_TYPE]: "not json" }))).toBeNull();
    expect(parseDocDrop(transfer({ [CRAFT_DOC_DRAG_TYPE]: JSON.stringify({ title: "no id" }) }))).toBeNull();
    expect(parseDocDrop(transfer({ "text/plain": "Roadmap" }))).toBeNull();
    expect(parseDocDrop(null)).toBeNull();
    expect(
      parseDocDrop({
        types: [CRAFT_DOC_DRAG_TYPE],
        getData: () => {
          throw new Error("denied");
        },
      }),
    ).toBeNull();
  });

  it("centres the default card on the drop point", () => {
    expect(cardOriginAt({ x: 500, y: 300 }, DEFAULT_SIZES.file)).toEqual({ x: 340, y: 200 });
    expect(cardOriginAt({ x: 0, y: 0 }, { width: 100, height: 50 })).toEqual({ x: -50, y: -25 });
  });

  it("finds the screen centre of the pane rectangle", () => {
    expect(rectCentre({ left: 280, top: 48, width: 1000, height: 600 })).toEqual({ x: 780, y: 348 });
  });

  it("converts a drop payload into the file node extension", () => {
    expect(docToFileExtension({ craftDocId: "d1", title: "Roadmap", folderPath: "Projects" }, "conn-1")).toEqual({
      craftDocId: "d1",
      connectionId: "conn-1",
      title: "Roadmap",
      folderPath: "Projects",
    });
    expect(docToFileExtension({ craftDocId: "d1", title: "", folderPath: "" }, "conn-1")).toEqual({ craftDocId: "d1", connectionId: "conn-1", title: "Untitled" });
  });
});
