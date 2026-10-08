import { describe, expect, it } from "vitest";

import { canvasDataSchema, emptyCanvas } from "@/lib/canvas/schema";
import type { CanvasData } from "@/lib/canvas/types";

import { contentDisposition, filenameFor, safeFilename, serialiseCanvasFile, toJsonCanvas } from "./canvas-file";

const sample: CanvasData = {
  nodes: [
    {
      id: "n1",
      type: "file",
      x: 0,
      y: 0,
      width: 320,
      height: 200,
      file: "craft/My Project/Research notes.md",
      color: "4",
      craftcanvas: { craftDocId: "abc123", connectionId: "conn-1", title: "Research notes", folderPath: "My Project" },
    },
    { id: "n2", type: "text", x: 400, y: 0, width: 240, height: 120, text: "## Key question\nWhy does..." },
    { id: "n3", type: "text", x: 400, y: 200, width: 240, height: 120, text: "sized", craftcanvas: { manualSize: true } },
    { id: "g1", type: "group", x: -40, y: -60, width: 720, height: 320, label: "Phase 1" },
  ],
  edges: [{ id: "e1", fromNode: "n1", toNode: "n2", fromSide: "right", toSide: "left", toEnd: "arrow", label: "supports" }],
  craftcanvas: { viewport: { x: 0, y: 0, zoom: 1 }, grid: true },
};

describe("toJsonCanvas", () => {
  it("has only nodes, edges and craftcanvas at the top level", () => {
    const out = toJsonCanvas(sample);
    expect(Object.keys(out).sort()).toEqual(["craftcanvas", "edges", "nodes"]);
  });

  it("validates against canvasDataSchema and round trips through JSON", () => {
    const out = toJsonCanvas(sample);
    const parsed = canvasDataSchema.safeParse(out);
    expect(parsed.success).toBe(true);
    const roundTripped = JSON.parse(JSON.stringify(out));
    expect(roundTripped).toEqual(out);
    expect(toJsonCanvas(roundTripped)).toEqual(out);
  });

  it("keeps file paths and per node craftcanvas extensions", () => {
    const out = toJsonCanvas(sample);
    const file = out.nodes.find((n) => n.id === "n1");
    expect(file).toMatchObject({
      type: "file",
      file: "craft/My Project/Research notes.md",
      craftcanvas: { craftDocId: "abc123", connectionId: "conn-1", title: "Research notes", folderPath: "My Project" },
    });
    const sized = out.nodes.find((n) => n.id === "n3");
    expect(sized).toMatchObject({ craftcanvas: { manualSize: true } });
    expect(out.edges[0]).toEqual({
      id: "e1",
      fromNode: "n1",
      toNode: "n2",
      fromSide: "right",
      toSide: "left",
      toEnd: "arrow",
      label: "supports",
    });
  });

  it("strips undefined values and unknown keys", () => {
    const dirty = {
      ...sample,
      nodes: [{ ...sample.nodes[1], color: undefined, bogus: 1 }],
      edges: [],
      extra: "nope",
    } as unknown as CanvasData;
    const out = toJsonCanvas(dirty);
    expect(Object.keys(out).sort()).toEqual(["craftcanvas", "edges", "nodes"]);
    expect("color" in out.nodes[0]).toBe(false);
    expect("bogus" in out.nodes[0]).toBe(false);
  });

  it("omits the top level block when the document has none", () => {
    const out = toJsonCanvas({ nodes: [], edges: [] });
    expect(out).toEqual({ nodes: [], edges: [] });
    expect("craftcanvas" in out).toBe(false);
  });

  it("throws for an invalid document rather than exporting garbage", () => {
    expect(() => toJsonCanvas({ nodes: [{ id: "x" }], edges: [] } as unknown as CanvasData)).toThrow();
  });
});

describe("serialiseCanvasFile", () => {
  it("writes pretty JSON with a trailing newline", () => {
    const text = serialiseCanvasFile(emptyCanvas());
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(toJsonCanvas(emptyCanvas()));
  });
});

describe("file names", () => {
  it("builds <safe title>.canvas", () => {
    expect(filenameFor("Q3 plan")).toBe("Q3 plan.canvas");
    expect(filenameFor("  Ideas / research: v2?  ")).toBe("Ideas - research- v2-.canvas");
    expect(filenameFor("")).toBe("canvas.canvas");
    expect(filenameFor("...")).toBe("canvas.canvas");
  });

  it("caps very long titles", () => {
    expect(safeFilename("x".repeat(500)).length).toBeLessThanOrEqual(120);
  });

  it("produces an ASCII and a UTF-8 Content-Disposition", () => {
    const header = contentDisposition("Café plan.canvas");
    expect(header).toContain('attachment; filename="Caf_ plan.canvas"');
    expect(header).toContain("filename*=UTF-8''Caf%C3%A9%20plan.canvas");
  });
});
