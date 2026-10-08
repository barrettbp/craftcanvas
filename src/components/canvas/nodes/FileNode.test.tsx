import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileFlowNode } from "@/lib/canvas/convert";
import type { CanvasData } from "@/lib/canvas/types";
import { selectDocCount, useCanvasStore } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";

import { FileNode } from "./FileNode";

const data: CanvasData = {
  nodes: [
    { id: "f1", type: "file", x: 0, y: 0, width: 320, height: 200, file: "craft/Doc.md", craftcanvas: { craftDocId: "doc-1", connectionId: "c", title: "Doc", preview: "# Hello" } },
    { id: "f2", type: "file", x: 400, y: 0, width: 320, height: 200, file: "craft/Doc.md", craftcanvas: { craftDocId: "doc-1", connectionId: "c", title: "Doc" } },
    { id: "f3", type: "file", x: 800, y: 0, width: 320, height: 200, file: "craft/Gone.md", craftcanvas: { craftDocId: "doc-2", connectionId: "c", title: "Gone", missing: true } },
    { id: "t", type: "text", x: 0, y: 400, width: 200, height: 100, text: "not a file" },
  ],
  edges: [],
};

function renderNode(id: string) {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === id) as FileFlowNode;
  const props = {
    id: node.id,
    data: node.data,
    type: "file",
    selected: false,
    dragging: false,
    isConnectable: true,
    zIndex: 1,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    draggable: true,
    selectable: true,
    deletable: true,
  } as unknown as NodeProps<FileFlowNode>;
  return render(
    <ReactFlowProvider>
      <FileNode {...props} />
    </ReactFlowProvider>,
  );
}

describe("FileNode", () => {
  beforeEach(() => {
    useCanvasStore.getState().load({ id: "canvas-1", title: "Test", version: 1, data });
    useUiStore.setState({ loadingPreviews: {}, craft: { connectionId: "c", spaceId: null, unauthorized: false } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("counts cards per document for the duplicate badge", () => {
    const state = useCanvasStore.getState();
    expect(selectDocCount(state, "doc-1")).toBe(2);
    expect(selectDocCount(state, "doc-2")).toBe(1);
    expect(selectDocCount(state, "doc-9")).toBe(0);
  });

  it("shows the badge only when the document is on the canvas more than once", () => {
    renderNode("f1");
    expect(screen.getByLabelText("On canvas 2 times")).toHaveTextContent("2");
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("renders the missing state without a badge", () => {
    renderNode("f3");
    expect(screen.getByText("Missing in Craft")).toBeInTheDocument();
    expect(screen.queryByLabelText(/On canvas/)).not.toBeInTheDocument();
  });

  it("shows a shimmer while the preview is loading and the card has no preview yet", () => {
    useUiStore.getState().setPreviewLoading("doc-1", true);
    renderNode("f2");
    expect(screen.getByRole("status", { name: "Loading preview" })).toBeInTheDocument();
  });

  it("removes the card from the canvas", () => {
    renderNode("f2");
    fireEvent.click(screen.getByRole("button", { name: "Remove from canvas" }));
    expect(useCanvasStore.getState().nodes.map((n) => n.id)).toEqual(["f1", "f3", "t"]);
  });

  it("opens in Craft on double click", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { container } = renderNode("f1");
    fireEvent.doubleClick(container.querySelector(".cc-card")!);
    expect(click).toHaveBeenCalledTimes(1);
  });
});
