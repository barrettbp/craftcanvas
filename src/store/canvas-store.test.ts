import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TextNodeData } from "@/lib/canvas/convert";
import { emptyCanvas } from "@/lib/canvas/schema";
import type { CanvasData } from "@/lib/canvas/types";

import { COALESCE_MS, HISTORY_LIMIT, selectDocCounts, selectDocIdsOnCanvas, useCanvasStore } from "./canvas-store";

const base: CanvasData = {
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "A" },
    { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "B" },
    {
      id: "f",
      type: "file",
      x: 0,
      y: 300,
      width: 320,
      height: 200,
      file: "craft/Doc.md",
      craftcanvas: { craftDocId: "doc-1", connectionId: "c", title: "Doc" },
    },
  ],
  edges: [{ id: "ab", fromNode: "a", toNode: "b", fromSide: "right", toSide: "left" }],
  craftcanvas: { viewport: { x: 5, y: 6, zoom: 1.5 }, grid: true },
};

function load(data: CanvasData = base) {
  useCanvasStore.getState().load({ id: "canvas-1", title: "Test", version: 1, data });
}

const store = () => useCanvasStore.getState();

describe("canvas store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    load();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("load / data", () => {
    it("hydrates nodes, edges, viewport and grid and starts clean", () => {
      const s = store();
      expect(s.nodes.map((n) => n.id)).toEqual(["a", "b", "f"]);
      expect(s.edges).toHaveLength(1);
      expect(s.viewport).toEqual({ x: 5, y: 6, zoom: 1.5 });
      expect(s.grid).toBe(true);
      expect(s.dirty).toBe(false);
      expect(s.canUndo).toBe(false);
      expect(s.saveState).toBe("saved");
    });

    it("round trips through getCanvasData", () => {
      expect(store().getCanvasData()).toEqual(base);
    });

    it("persists the viewport without creating an undo step", () => {
      store().setViewport({ x: 1, y: 2, zoom: 2 });
      expect(store().dirty).toBe(true);
      expect(store().canUndo).toBe(false);
      expect(store().getCanvasData().craftcanvas?.viewport).toEqual({ x: 1, y: 2, zoom: 2 });
    });
  });

  describe("nodes and edges", () => {
    it("adds a text card at the given position, snapped to the grid, and selects it", () => {
      const id = store().addTextNode({ x: 13, y: 21 }, "hello");
      const node = store().nodes.find((n) => n.id === id)!;
      expect(node.position).toEqual({ x: 16, y: 24 });
      expect(node.selected).toBe(true);
      expect(store().selection.nodeIds).toEqual([id]);
      expect(store().dirty).toBe(true);
      expect(store().canUndo).toBe(true);
    });

    it("removes nodes together with their edges", () => {
      store().removeNodes(["a"]);
      expect(store().nodes.map((n) => n.id)).toEqual(["b", "f"]);
      expect(store().edges).toHaveLength(0);
    });

    it("removeSelected deletes selected nodes and edges", () => {
      store().select(["b"], ["ab"]);
      store().removeSelected();
      expect(store().nodes.map((n) => n.id)).toEqual(["a", "f"]);
      expect(store().edges).toHaveLength(0);
    });

    it("colours nodes and edges, and clears with undefined", () => {
      store().setNodesColor(["a"], "3");
      store().setEdgesColor(["ab"], "#ff0000");
      expect((store().nodes[0].data as TextNodeData).color).toBe("3");
      expect(store().edges[0].data?.color).toBe("#ff0000");
      expect(store().edges[0].markerEnd).toMatchObject({ color: "#ff0000" });
      store().setNodesColor(["a"], undefined);
      expect((store().nodes[0].data as TextNodeData).color).toBeUndefined();
    });

    it("connects two selected nodes with one arrow and refuses duplicates", () => {
      store().select(["a", "f"]);
      const id = store().connectSelected();
      expect(id).not.toBeNull();
      const edge = store().edges.find((e) => e.id === id)!;
      expect(edge.source).toBe("a");
      expect(edge.target).toBe("f");
      expect(edge.sourceHandle).toBe("bottom");
      expect(edge.targetHandle).toBe("top");
      expect(edge.data).toEqual({ fromEnd: "none", toEnd: "arrow" });
      expect(store().addEdge("f", "a")).toBeNull();
      expect(store().addEdge("a", "a")).toBeNull();
    });

    it("onConnect adds an edge from handle ids", () => {
      store().onConnect({ source: "b", sourceHandle: "bottom", target: "f", targetHandle: "right" });
      const edge = store().edges.find((e) => e.source === "b" && e.target === "f")!;
      expect(edge.sourceHandle).toBe("bottom");
      expect(edge.targetHandle).toBe("right");
    });

    it("changes edge direction and label", () => {
      store().setEdgeDirection("ab", "both");
      expect(store().edges[0].data).toMatchObject({ fromEnd: "arrow", toEnd: "arrow" });
      expect(store().edges[0].markerStart).toBeDefined();
      store().setEdgeDirection("ab", "none");
      expect(store().edges[0].markerStart).toBeUndefined();
      expect(store().edges[0].markerEnd).toBeUndefined();
      store().setEdgeLabel("ab", "supports");
      // Default `fromEnd: "none"` is omitted on export; the non default `toEnd: "none"` is written.
      const exported = store().getCanvasData().edges[0];
      expect(exported).toMatchObject({ label: "supports", toEnd: "none" });
      expect(exported.fromEnd).toBeUndefined();
    });

    it("wraps the selection in a group that becomes the parent", () => {
      store().select(["a", "b"]);
      const gid = store().wrapSelectionInGroup();
      expect(gid).not.toBeNull();
      const group = store().nodes.find((n) => n.id === gid)!;
      expect(group.type).toBe("group");
      expect(store().nodes[0].id).toBe(gid); // groups first
      const a = store().nodes.find((n) => n.id === "a")!;
      expect(a.parentId).toBe(gid);
      expect(store().selection.nodeIds).toEqual([gid]);
      // The group contains both cards with padding.
      const data = store().getCanvasData();
      const g = data.nodes.find((n) => n.id === gid)!;
      expect(g.x).toBeLessThan(0);
      expect(g.x + g.width).toBeGreaterThan(600);
    });

    it("duplicates nodes with internal edges and selects the clones", () => {
      store().select(["a", "b"]);
      const ids = store().duplicateSelected();
      expect(ids).toHaveLength(2);
      expect(store().nodes).toHaveLength(5);
      expect(store().edges).toHaveLength(2);
      expect(store().selection.nodeIds.sort()).toEqual([...ids].sort());
      const clone = store().nodes.find((n) => n.id === ids[0])!;
      expect(clone.position).toEqual({ x: 24, y: 24 });
      const cloneEdge = store().edges.find((e) => e.id !== "ab")!;
      expect(ids).toContain(cloneEdge.source);
      expect(ids).toContain(cloneEdge.target);
    });

    it("duplicates in place without moving selection (Alt drag)", () => {
      store().select(["a"]);
      const ids = store().duplicateNodes(["a"], { offset: 0, selectClones: false });
      const clone = store().nodes.find((n) => n.id === ids[0])!;
      expect(clone.position).toEqual({ x: 0, y: 0 });
      expect(clone.selected).toBe(false);
      expect(store().selection.nodeIds).toEqual(["a"]);
    });

    it("nudges the selection", () => {
      store().select(["a"]);
      store().nudgeSelected(10, -1);
      expect(store().nodes.find((n) => n.id === "a")!.position).toEqual({ x: 10, y: -1 });
    });

    it("adds a file node from the notes panel contract", () => {
      const id = store().addFileNode({ craftDocId: "doc-2", connectionId: "c", title: "Plan: v1", folderPath: "Work/2026" }, { x: 50, y: 50 });
      const data = store().getCanvasData();
      const node = data.nodes.find((n) => n.id === id)!;
      expect(node).toMatchObject({ type: "file", file: "craft/Work/2026/Plan- v1.md", width: 320, height: 200 });
      expect(selectDocIdsOnCanvas(store())).toEqual(new Set(["doc-1", "doc-2"]));
      store().addFileNode({ craftDocId: "doc-1", connectionId: "c", title: "Doc" }, { x: 0, y: 0 });
      expect(selectDocCounts(store()).get("doc-1")).toBe(2);
    });

    it("selectAll / clearSelection do not dirty the document", () => {
      store().selectAll();
      expect(store().selection.nodeIds).toHaveLength(3);
      expect(store().selection.edgeIds).toEqual(["ab"]);
      store().clearSelection();
      expect(store().selection.nodeIds).toEqual([]);
      expect(store().dirty).toBe(false);
      expect(store().canUndo).toBe(false);
    });
  });

  describe("React Flow changes", () => {
    it("ignores selection and measurement changes for history and dirty", () => {
      store().onNodesChange([
        { id: "a", type: "select", selected: true },
        { id: "a", type: "dimensions", dimensions: { width: 200, height: 150 } },
      ]);
      expect(store().selection.nodeIds).toEqual(["a"]);
      expect(store().nodes[0].measured).toEqual({ width: 200, height: 150 });
      expect(store().dirty).toBe(false);
      expect(store().canUndo).toBe(false);
    });

    it("treats a resize as a user change", () => {
      store().onNodesChange([{ id: "a", type: "dimensions", dimensions: { width: 300, height: 150 }, setAttributes: true, resizing: true }]);
      store().onNodesChange([{ id: "a", type: "dimensions", resizing: false }]);
      expect(store().nodes[0].width).toBe(300);
      expect(store().dirty).toBe(true);
      expect(store().history.past).toHaveLength(1);
    });

    it("keeps children in place when a group is resized from its top left corner", () => {
      store().select(["a", "b"]);
      const gid = store().wrapSelectionInGroup()!;
      const before = store().getCanvasData().nodes.find((n) => n.id === "a")!;
      const group = store().nodes.find((n) => n.id === gid)!;
      // NodeResizer moves the origin and shrinks the box in one change set.
      store().onNodesChange([
        { id: gid, type: "position", position: { x: group.position.x + 10, y: group.position.y + 8 } },
        { id: gid, type: "dimensions", dimensions: { width: group.width! - 10, height: group.height! - 8 }, setAttributes: true, resizing: true },
      ]);
      store().onNodesChange([{ id: gid, type: "dimensions", resizing: false }]);
      const after = store().getCanvasData().nodes.find((n) => n.id === "a")!;
      expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
      expect(store().history.past).toHaveLength(2); // wrap + resize
    });

    it("removes edges when React Flow removes nodes", () => {
      store().onNodesChange([{ id: "a", type: "remove" }]);
      expect(store().edges).toHaveLength(0);
    });
  });

  describe("undo / redo", () => {
    it("groups a whole drag into one step", () => {
      for (let i = 1; i <= 5; i += 1) {
        store().onNodesChange([{ id: "a", type: "position", position: { x: i * 10, y: 0 }, dragging: true }]);
      }
      store().onNodesChange([{ id: "a", type: "position", position: { x: 50, y: 0 }, dragging: false }]);
      expect(store().nodes[0].position).toEqual({ x: 50, y: 0 });
      expect(store().history.past).toHaveLength(1);
      expect(store().history.batch).toBeNull();
      store().undo();
      expect(store().nodes[0].position).toEqual({ x: 0, y: 0 });
      expect(store().canUndo).toBe(false);
      expect(store().canRedo).toBe(true);
      store().redo();
      expect(store().nodes[0].position).toEqual({ x: 50, y: 0 });
    });

    it("groups explicit batches and discards empty ones", () => {
      store().beginBatch();
      store().endBatch();
      expect(store().history.past).toHaveLength(0);
      store().beginBatch();
      store().setNodesColor(["a"], "1");
      store().nudgeSelected(1, 1);
      store().setEdgesColor(["ab"], "2");
      store().endBatch();
      expect(store().history.past).toHaveLength(1);
      store().undo();
      expect((store().nodes[0].data as TextNodeData).color).toBeUndefined();
      expect(store().edges[0].data?.color).toBeUndefined();
    });

    it("coalesces typing in a text card and splits after a pause or blur", () => {
      store().setNodeText("a", "A1");
      store().setNodeText("a", "A12");
      store().setNodeText("a", "A123");
      expect(store().history.past).toHaveLength(1);
      vi.advanceTimersByTime(COALESCE_MS + 1);
      store().setNodeText("a", "A1234");
      expect(store().history.past).toHaveLength(2);
      store().breakCoalescing();
      store().setNodeText("a", "A12345");
      expect(store().history.past).toHaveLength(3);
      store().undo();
      expect((store().nodes[0].data as TextNodeData).text).toBe("A1234");
      store().undo();
      expect((store().nodes[0].data as TextNodeData).text).toBe("A123");
      store().undo();
      expect((store().nodes[0].data as TextNodeData).text).toBe("A");
    });

    it("does not coalesce different cards", () => {
      store().setNodeText("a", "x");
      store().setNodeText("b", "y");
      expect(store().history.past).toHaveLength(2);
    });

    it("clears the redo stack on a new change", () => {
      store().setNodesColor(["a"], "1");
      store().undo();
      expect(store().canRedo).toBe(true);
      store().setNodesColor(["b"], "2");
      expect(store().canRedo).toBe(false);
      expect(store().history.future).toHaveLength(0);
    });

    it("caps history at the limit", () => {
      for (let i = 0; i < HISTORY_LIMIT + 20; i += 1) {
        store().setNodesColor(["a"], i % 2 ? "1" : "2");
      }
      expect(store().history.past).toHaveLength(HISTORY_LIMIT);
      let steps = 0;
      while (store().canUndo) {
        store().undo();
        steps += 1;
      }
      expect(steps).toBe(HISTORY_LIMIT);
    });

    it("undo marks the document dirty so it gets saved", () => {
      store().setNodesColor(["a"], "1");
      store().markSaved(2, store().changeSeq);
      expect(store().dirty).toBe(false);
      store().undo();
      expect(store().dirty).toBe(true);
    });
  });

  describe("save pipeline state", () => {
    it("markSaved clears dirty only when nothing changed since the snapshot", () => {
      store().setNodesColor(["a"], "1");
      const seq = store().changeSeq;
      store().setSaveState("saving");
      store().setNodesColor(["b"], "2");
      store().markSaved(2, seq);
      expect(store().version).toBe(2);
      expect(store().saveState).toBe("saved");
      expect(store().dirty).toBe(true);
      store().markSaved(3, store().changeSeq);
      expect(store().dirty).toBe(false);
    });

    it("replaceFromServer swaps the document and version after a conflict", () => {
      store().setNodesColor(["a"], "1");
      store().setSaveState("conflict");
      store().replaceFromServer({ id: "canvas-1", title: "Other tab", version: 9, thumbnail: null, createdAt: "", updatedAt: "", data: emptyCanvas() });
      expect(store().nodes).toEqual([]);
      expect(store().version).toBe(9);
      expect(store().title).toBe("Other tab");
      expect(store().dirty).toBe(false);
      expect(store().saveState).toBe("conflict");
      expect(store().canUndo).toBe(false);
    });
  });
});
