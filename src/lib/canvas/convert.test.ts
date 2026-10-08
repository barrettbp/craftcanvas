import { describe, expect, it } from "vitest";

import { assignParents, attachParents, fromFlow, normaliseCanvasData, toFlow } from "./convert";
import type { CanvasData } from "./types";

const doc: CanvasData = {
  nodes: [
    { id: "g1", type: "group", x: -40, y: -60, width: 720, height: 320, label: "Phase 1", color: "2" },
    {
      id: "n1",
      type: "file",
      x: 0,
      y: 0,
      width: 320,
      height: 200,
      file: "craft/My Project/Research notes.md",
      color: "4",
      craftcanvas: { craftDocId: "abc123", connectionId: "conn", title: "Research notes", folderPath: "My Project", preview: "Hi" },
    },
    { id: "n2", type: "text", x: 400, y: 0, width: 240, height: 120, text: "## Key question", craftcanvas: { manualSize: true } },
    { id: "n3", type: "text", x: 1000, y: 1000, width: 240, height: 120, text: "outside" },
    { id: "l1", type: "link", x: 10, y: 500, width: 200, height: 80, url: "https://example.com" },
  ],
  edges: [
    { id: "e1", fromNode: "n1", toNode: "n2", fromSide: "right", toSide: "left", label: "supports", color: "1" },
    { id: "e2", fromNode: "n2", toNode: "n3", fromSide: "bottom", toSide: "top", fromEnd: "arrow", toEnd: "none" },
  ],
  craftcanvas: { viewport: { x: 12, y: -8, zoom: 0.75 }, grid: false },
};

describe("toFlow", () => {
  it("makes groups parent containers of nodes fully inside them", () => {
    const { nodes } = toFlow(doc);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get("n1")?.parentId).toBe("g1");
    expect(byId.get("n2")?.parentId).toBe("g1");
    expect(byId.get("n3")?.parentId).toBeUndefined();
    expect(byId.get("l1")?.parentId).toBeUndefined();
    // Child positions are relative to the group.
    expect(byId.get("n1")?.position).toEqual({ x: 40, y: 60 });
    expect(byId.get("n2")?.position).toEqual({ x: 440, y: 60 });
  });

  it("puts groups first with a lower z-index", () => {
    const { nodes } = toFlow(doc);
    expect(nodes[0].id).toBe("g1");
    expect(nodes[0].zIndex).toBeLessThan(nodes[1].zIndex!);
  });

  it("maps edges to handles and markers", () => {
    const { edges } = toFlow(doc);
    const e1 = edges.find((e) => e.id === "e1")!;
    expect(e1.source).toBe("n1");
    expect(e1.target).toBe("n2");
    expect(e1.sourceHandle).toBe("right");
    expect(e1.targetHandle).toBe("left");
    expect(e1.data).toEqual({ fromEnd: "none", toEnd: "arrow", label: "supports", color: "1" });
    expect(e1.markerEnd).toBeDefined();
    expect(e1.markerStart).toBeUndefined();
    const e2 = edges.find((e) => e.id === "e2")!;
    expect(e2.markerStart).toBeDefined();
    expect(e2.markerEnd).toBeUndefined();
  });

  it("infers sides when the edge has none", () => {
    const { edges } = toFlow({
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 100, height: 50, text: "" },
        { id: "b", type: "text", x: 300, y: 0, width: 100, height: 50, text: "" },
        { id: "c", type: "text", x: 0, y: 300, width: 100, height: 50, text: "" },
      ],
      edges: [
        { id: "ab", fromNode: "a", toNode: "b" },
        { id: "ac", fromNode: "a", toNode: "c" },
      ],
    });
    expect(edges[0].sourceHandle).toBe("right");
    expect(edges[0].targetHandle).toBe("left");
    expect(edges[1].sourceHandle).toBe("bottom");
    expect(edges[1].targetHandle).toBe("top");
  });

  it("drops edges that reference missing nodes", () => {
    const { edges } = toFlow({ nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 1, height: 1, text: "" }], edges: [{ id: "e", fromNode: "a", toNode: "zz" }] });
    expect(edges).toHaveLength(0);
  });

  it("lets auto sized text cards take their height from the DOM", () => {
    const { nodes } = toFlow(doc);
    const auto = nodes.find((n) => n.id === "n3")!;
    const manual = nodes.find((n) => n.id === "n2")!;
    expect(auto.height).toBeUndefined();
    expect(auto.initialHeight).toBe(120);
    expect(manual.height).toBe(120);
  });
});

describe("round trip", () => {
  it("fromFlow(toFlow(doc)) equals the document", () => {
    const { nodes, edges } = toFlow(doc);
    expect(fromFlow(nodes, edges, doc.craftcanvas)).toEqual(doc);
  });

  it("is stable under repeated conversion", () => {
    const once = normaliseCanvasData(doc);
    expect(normaliseCanvasData(once)).toEqual(once);
  });

  it("normalises default edge ends and node order", () => {
    const messy: CanvasData = {
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 100, height: 50, text: "a" },
        { id: "g", type: "group", x: -10, y: -10, width: 400, height: 300 },
      ],
      edges: [{ id: "e", fromNode: "a", toNode: "g", fromSide: "left", toSide: "right", fromEnd: "none", toEnd: "arrow" }],
    };
    const out = normaliseCanvasData(messy);
    expect(out.nodes.map((n) => n.id)).toEqual(["g", "a"]);
    expect(out.edges[0]).toEqual({ id: "e", fromNode: "a", toNode: "g", fromSide: "left", toSide: "right" });
  });

  it("uses measured dimensions when a node has no explicit size", () => {
    const { nodes, edges } = toFlow(doc);
    const withMeasured = nodes.map((n) => (n.id === "n3" ? { ...n, measured: { width: 240, height: 333 } } : n));
    const out = fromFlow(withMeasured, edges);
    expect(out.nodes.find((n) => n.id === "n3")?.height).toBe(333);
  });
});

describe("assignParents / attachParents", () => {
  it("picks the smallest containing group and never nests equal groups", () => {
    const parents = assignParents([
      { id: "outer", type: "group", rect: { x: 0, y: 0, width: 1000, height: 1000 } },
      { id: "inner", type: "group", rect: { x: 100, y: 100, width: 400, height: 400 } },
      { id: "twin", type: "group", rect: { x: 100, y: 100, width: 400, height: 400 } },
      { id: "card", type: "text", rect: { x: 150, y: 150, width: 100, height: 50 } },
      { id: "half", type: "text", rect: { x: 450, y: 450, width: 100, height: 100 } },
    ]);
    expect(parents.get("card")).toBe("inner");
    expect(parents.get("inner")).toBe("outer");
    expect(parents.get("twin")).toBe("outer");
    expect(parents.get("half")).toBe("outer");
    expect(parents.get("outer")).toBeUndefined();
  });

  it("re-parents after a node moves out of its group", () => {
    const { nodes } = toFlow(doc);
    const moved = nodes.map((n) => (n.id === "n1" ? { ...n, position: { x: 2000, y: 2000 } } : n));
    const next = attachParents(moved);
    const n1 = next.find((n) => n.id === "n1")!;
    expect(n1.parentId).toBeUndefined();
    // Relative (40,60) inside g1 at (-40,-60) plus the move => absolute (1960, 1940)
    expect(n1.position).toEqual({ x: 1960, y: 1940 });
  });
});
