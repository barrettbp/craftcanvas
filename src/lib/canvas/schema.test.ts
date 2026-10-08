import { describe, expect, it } from "vitest";

import { canvasDataSchema, emptyCanvas, newId, safeParseCanvasData } from "./schema";

const sample = {
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
      craftcanvas: { craftDocId: "abc123", connectionId: "conn-1", title: "Research notes" },
    },
    { id: "n2", type: "text", x: 400, y: 0, width: 240, height: 120, text: "## Key question\nWhy does..." },
    { id: "g1", type: "group", x: -40, y: -60, width: 720, height: 320, label: "Phase 1" },
    { id: "l1", type: "link", x: 10, y: 400, width: 200, height: 80, url: "https://example.com" },
  ],
  edges: [{ id: "e1", fromNode: "n1", toNode: "n2", fromSide: "right", toSide: "left", toEnd: "arrow", label: "supports" }],
  craftcanvas: { viewport: { x: 0, y: 0, zoom: 1 }, grid: true },
};

describe("canvasDataSchema", () => {
  it("accepts the spec example", () => {
    const result = canvasDataSchema.safeParse(sample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nodes).toHaveLength(4);
      expect(result.data.edges[0].label).toBe("supports");
      expect(result.data.craftcanvas?.viewport?.zoom).toBe(1);
    }
  });

  it("accepts an empty canvas", () => {
    expect(canvasDataSchema.safeParse(emptyCanvas()).success).toBe(true);
    expect(canvasDataSchema.safeParse({}).success).toBe(true);
  });

  it("accepts preset ids and hex colours, rejects other colours", () => {
    const node = (color: string) => ({ nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 10, height: 10, text: "", color }], edges: [] });
    expect(canvasDataSchema.safeParse(node("1")).success).toBe(true);
    expect(canvasDataSchema.safeParse(node("6")).success).toBe(true);
    expect(canvasDataSchema.safeParse(node("#ff0000")).success).toBe(true);
    expect(canvasDataSchema.safeParse(node("#abc")).success).toBe(true);
    expect(canvasDataSchema.safeParse(node("7")).success).toBe(false);
    expect(canvasDataSchema.safeParse(node("red")).success).toBe(false);
  });

  it("rejects unknown node types and missing required fields", () => {
    expect(canvasDataSchema.safeParse({ nodes: [{ id: "a", type: "image", x: 0, y: 0, width: 1, height: 1 }], edges: [] }).success).toBe(false);
    expect(canvasDataSchema.safeParse({ nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 1, height: 1 }], edges: [] }).success).toBe(false);
    expect(
      canvasDataSchema.safeParse({ nodes: [{ id: "a", type: "file", x: 0, y: 0, width: 1, height: 1, file: "x.md" }], edges: [] }).success,
    ).toBe(false);
  });

  it("rejects duplicate ids and dangling edges", () => {
    const dup = {
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 1, height: 1, text: "" },
        { id: "a", type: "text", x: 0, y: 0, width: 1, height: 1, text: "" },
      ],
      edges: [],
    };
    expect(canvasDataSchema.safeParse(dup).success).toBe(false);
    const dangling = { nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 1, height: 1, text: "" }], edges: [{ id: "e", fromNode: "a", toNode: "zzz" }] };
    expect(canvasDataSchema.safeParse(dangling).success).toBe(false);
  });

  it("rejects non positive sizes and bad sides", () => {
    expect(canvasDataSchema.safeParse({ nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 0, height: 1, text: "" }], edges: [] }).success).toBe(false);
    const badSide = {
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 1, height: 1, text: "" },
        { id: "b", type: "text", x: 0, y: 0, width: 1, height: 1, text: "" },
      ],
      edges: [{ id: "e", fromNode: "a", toNode: "b", fromSide: "middle" }],
    };
    expect(canvasDataSchema.safeParse(badSide).success).toBe(false);
  });

  it("strips unknown keys", () => {
    const parsed = safeParseCanvasData({ ...sample, foo: 1, nodes: sample.nodes.map((n) => ({ ...n, extra: true })) });
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("foo");
    for (const node of parsed!.nodes) expect(node).not.toHaveProperty("extra");
  });
});

describe("helpers", () => {
  it("emptyCanvas has a viewport and grid on", () => {
    expect(emptyCanvas()).toEqual({ nodes: [], edges: [], craftcanvas: { viewport: { x: 0, y: 0, zoom: 1 }, grid: true } });
  });

  it("newId produces short unique ids", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });
});
