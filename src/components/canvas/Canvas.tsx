"use client";

/**
 * The React Flow canvas (spec section 8). Wires the store to React Flow,
 * handles the pointer side of the interactions table (pan, zoom, marquee,
 * Alt drag duplicate, double click for a text card, context menus, snap to
 * grid with Alt to disable, alignment guides) and renders the custom nodes
 * and edges. Must be rendered inside a `ReactFlowProvider`.
 */
import "@xyflow/react/dist/style.css";
import "./canvas.css";

import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type OnNodeDrag,
  type Viewport,
} from "@xyflow/react";
import { useCallback, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";

import { useCanvasShortcuts } from "@/hooks/useCanvasShortcuts";
import { addCraftDocument } from "@/hooks/useCraftPreviews";
import { resolveColor } from "@/lib/canvas/colors";
import { absoluteRects, type FlowEdge, type FlowNode } from "@/lib/canvas/convert";
import { cardOriginAt, hasDocDrag, parseDocDrop } from "@/lib/canvas/drop";
import { getHelperLines } from "@/lib/canvas/helper-lines";
import { DEFAULT_SIZES, GRID_SIZE } from "@/lib/canvas/types";
import { useCanvasStore } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";

import { ContextMenu } from "./ContextMenu";
import { CanvasEdge } from "./edges/CanvasEdge";
import { HelperLines } from "./HelperLines";
import { FileNode } from "./nodes/FileNode";
import { GroupNode } from "./nodes/GroupNode";
import { LinkNode } from "./nodes/LinkNode";
import { TextNode } from "./nodes/TextNode";
import { ToolOverlay } from "./ToolOverlay";

const nodeTypes = { text: TextNode, file: FileNode, group: GroupNode, link: LinkNode };
const edgeTypes = { canvas: CanvasEdge };
const snapGrid: [number, number] = [GRID_SIZE, GRID_SIZE];
const fitViewOptions = { padding: 0.2 };

function minimapColor(node: Node): string {
  const color = resolveColor((node.data as { color?: string } | undefined)?.color);
  if (node.type === "group") return color ?? "#d4d4d8";
  return color ?? "#a1a1aa";
}

export function Canvas({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const grid = useCanvasStore((s) => s.grid);
  const altHeld = useUiStore((s) => s.altHeld);
  const tool = useUiStore((s) => s.tool);
  const showMinimap = useUiStore((s) => s.showMinimap);
  const setHelperLines = useUiStore((s) => s.setHelperLines);
  const openContextMenu = useUiStore((s) => s.openContextMenu);
  const closeContextMenu = useUiStore((s) => s.closeContextMenu);
  const setEditingNode = useUiStore((s) => s.setEditingNode);
  const setEditingEdge = useUiStore((s) => s.setEditingEdge);
  const [initialViewport] = useState<Viewport>(() => useCanvasStore.getState().viewport);
  const [connecting, setConnecting] = useState(false);
  const rf = useReactFlow();

  useCanvasShortcuts(containerRef);

  const relativePoint = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const rect = containerRef.current?.getBoundingClientRect();
      return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
    },
    [containerRef],
  );

  /** Alignment guides: snap a single dragged node to nearby edges and centres. */
  const handleNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const store = useCanvasStore.getState();
      const only = changes.length === 1 ? changes[0] : null;
      if (only && only.type === "position" && only.dragging && only.position) {
        const node = store.nodes.find((n) => n.id === only.id);
        if (node) {
          const rects = absoluteRects(store.nodes);
          const own = rects.get(node.id)!;
          const parentRect = node.parentId ? rects.get(node.parentId) : undefined;
          const px = parentRect?.x ?? 0;
          const py = parentRect?.y ?? 0;
          const dragged = { x: only.position.x + px, y: only.position.y + py, width: own.width, height: own.height };
          const others = store.nodes
            .filter((n) => n.id !== node.id && !n.selected && n.parentId !== node.id)
            .map((n) => rects.get(n.id)!);
          const lines = getHelperLines(dragged, others);
          const position = { ...only.position };
          if (lines.snapX !== undefined) position.x = lines.snapX - px;
          if (lines.snapY !== undefined) position.y = lines.snapY - py;
          setHelperLines({ horizontal: lines.horizontal, vertical: lines.vertical });
          store.onNodesChange([{ ...only, position }]);
          return;
        }
      }
      if (changes.some((c) => c.type === "position" && c.dragging === false)) setHelperLines({});
      store.onNodesChange(changes);
    },
    [setHelperLines],
  );

  const onNodeDragStart = useCallback<OnNodeDrag<FlowNode>>((event, _node, draggedNodes) => {
    const store = useCanvasStore.getState();
    useUiStore.getState().closeContextMenu();
    store.beginBatch();
    if (event.altKey) {
      // Alt drag duplicates: leave copies at the original positions and keep
      // dragging the selected originals, all inside one undo step.
      store.duplicateNodes(
        draggedNodes.map((n) => n.id),
        { offset: 0, selectClones: false },
      );
    }
  }, []);

  const onNodeDragStop = useCallback(() => {
    setHelperLines({});
    useCanvasStore.getState().endBatch();
  }, [setHelperLines]);

  const onPaneDoubleClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains("react-flow__pane")) return;
      const store = useCanvasStore.getState();
      const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const size = DEFAULT_SIZES.text;
      const id = store.addTextNode({ x: pos.x - size.width / 2, y: pos.y - size.height / 2 });
      setEditingNode(id);
    },
    [rf, setEditingNode],
  );

  const onPaneContextMenu = useCallback(
    (e: ReactMouseEvent | MouseEvent) => {
      e.preventDefault();
      const point = relativePoint(e);
      openContextMenu({ kind: "pane", ...point, flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) });
    },
    [openContextMenu, relativePoint, rf],
  );

  const onNodeContextMenu = useCallback(
    (e: ReactMouseEvent, node: Node) => {
      e.preventDefault();
      const store = useCanvasStore.getState();
      if (!store.selection.nodeIds.includes(node.id)) store.select([node.id]);
      openContextMenu({ kind: "node", ...relativePoint(e), id: node.id });
    },
    [openContextMenu, relativePoint],
  );

  const onEdgeContextMenu = useCallback(
    (e: ReactMouseEvent, edge: Edge) => {
      e.preventDefault();
      const store = useCanvasStore.getState();
      if (!store.selection.edgeIds.includes(edge.id)) store.select([], [edge.id]);
      openContextMenu({ kind: "edge", ...relativePoint(e), id: edge.id });
    },
    [openContextMenu, relativePoint],
  );

  const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    useCanvasStore.getState().setViewport(viewport);
  }, []);

  /** Notes panel rows dropped on the pane become note cards where the pointer lands (spec 8.6). */
  const onDragOver = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDocDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      const doc = parseDocDrop(e.dataTransfer);
      if (!doc) return;
      e.preventDefault();
      closeContextMenu();
      const point = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addCraftDocument(doc, cardOriginAt(point, DEFAULT_SIZES.file));
    },
    [rf, closeContextMenu],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full" onDoubleClick={onPaneDoubleClick} onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow<FlowNode, FlowEdge>
        className={`cc-flow ${connecting ? "cc-connecting" : ""}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={() => setConnecting(true)}
        onConnectEnd={() => setConnecting(false)}
        isValidConnection={(c) => c.source !== c.target}
        connectionMode={ConnectionMode.Loose}
        defaultViewport={initialViewport}
        onMoveStart={closeContextMenu}
        onMoveEnd={onMoveEnd}
        minZoom={0.1}
        maxZoom={4}
        snapToGrid={grid && !altHeld}
        snapGrid={snapGrid}
        panOnDrag={tool === "select" ? [0, 1] : false}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        zoomActivationKeyCode={["Meta", "Control"]}
        panActivationKeyCode="Space"
        selectionKeyCode="Shift"
        multiSelectionKeyCode="Shift"
        selectionOnDrag={false}
        deleteKeyCode={null}
        disableKeyboardA11y
        elevateEdgesOnSelect
        nodeDragThreshold={2}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStart={() => useCanvasStore.getState().beginBatch()}
        onSelectionDragStop={onNodeDragStop}
        onPaneClick={closeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onEdgeDoubleClick={(_, edge) => setEditingEdge(edge.id)}
        fitViewOptions={fitViewOptions}
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE * 2} size={1} />
        {showMinimap ? <MiniMap pannable zoomable nodeColor={minimapColor} /> : null}
        <HelperLines />
      </ReactFlow>
      <ToolOverlay />
      <ContextMenu />
    </div>
  );
}
