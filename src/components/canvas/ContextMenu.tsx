"use client";

/**
 * Right click menus for the canvas, a node and an edge (spec 8.5). The menu
 * state lives in the UI store; the Canvas component opens it with
 * container relative coordinates.
 */
import { useReactFlow } from "@xyflow/react";
import { useEffect, useRef, type ReactNode } from "react";

import type { EdgeData, GroupNodeData } from "@/lib/canvas/convert";
import { DEFAULT_SIZES } from "@/lib/canvas/types";
import { useCanvasStore, type EdgeDirection } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";

import { ColorPicker } from "./ColorPicker";

function Item({ children, onClick, danger, disabled }: { children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm disabled:opacity-40 ${
        danger ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}

function Separator() {
  return <div className="my-1 border-t border-zinc-200 dark:border-zinc-700" />;
}

function Hint({ children }: { children: ReactNode }) {
  return <span className="ml-4 text-xs text-zinc-400">{children}</span>;
}

export function ContextMenu() {
  const menu = useUiStore((s) => s.contextMenu);
  const close = useUiStore((s) => s.closeContextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, close]);

  if (!menu) return null;

  const store = useCanvasStore.getState();
  const ui = useUiStore.getState();
  const run = (fn: () => void) => () => {
    fn();
    close();
  };

  let content: ReactNode;
  if (menu.kind === "pane") {
    content = (
      <>
        <Item
          onClick={run(() => {
            const id = store.addTextNode(menu.flow);
            ui.setEditingNode(id);
          })}
        >
          New text card <Hint>T</Hint>
        </Item>
        <Item
          onClick={run(() => {
            const id = store.addGroupNode({ ...menu.flow, ...DEFAULT_SIZES.group });
            ui.setEditingNode(id);
          })}
        >
          New group <Hint>G</Hint>
        </Item>
        <Separator />
        <Item onClick={run(() => store.selectAll())}>
          Select all <Hint>⌘A</Hint>
        </Item>
        <Item onClick={run(() => void rf.fitView({ padding: 0.2, duration: 200 }))}>
          Fit view <Hint>⇧1</Hint>
        </Item>
        <Item onClick={run(() => store.setGrid(!store.grid))}>{store.grid ? "Disable snap to grid" : "Enable snap to grid"}</Item>
      </>
    );
  } else if (menu.kind === "node") {
    const node = store.nodes.find((n) => n.id === menu.id);
    if (!node) return null;
    const selectedIds = store.selection.nodeIds.includes(menu.id) ? store.selection.nodeIds : [menu.id];
    const color = (node.data as { color?: string }).color;
    content = (
      <>
        {node.type === "text" || node.type === "group" ? (
          <Item onClick={run(() => ui.setEditingNode(node.id))}>
            {node.type === "group" ? "Rename group" : "Edit text"} <Hint>Enter</Hint>
          </Item>
        ) : null}
        <div className="px-2 py-1.5">
          <ColorPicker value={color} onPick={(c) => run(() => store.setNodesColor(selectedIds, c))()} />
        </div>
        <Separator />
        <Item onClick={run(() => store.duplicateNodes(selectedIds))}>
          Duplicate <Hint>⌘D</Hint>
        </Item>
        <Item
          onClick={run(() => {
            store.select(selectedIds);
            store.wrapSelectionInGroup();
          })}
        >
          Wrap in group <Hint>G</Hint>
        </Item>
        {selectedIds.length === 2 ? (
          <Item
            onClick={run(() => {
              store.select(selectedIds);
              store.connectSelected();
            })}
          >
            Connect <Hint>A</Hint>
          </Item>
        ) : null}
        <Separator />
        <Item danger onClick={run(() => store.removeNodes(selectedIds))}>
          {node.type === "group" && !(node.data as GroupNodeData).label ? "Delete group" : "Delete"} <Hint>⌫</Hint>
        </Item>
      </>
    );
  } else {
    const edge = store.edges.find((e) => e.id === menu.id);
    if (!edge) return null;
    const data: EdgeData = edge.data ?? { fromEnd: "none", toEnd: "arrow" };
    const direction: EdgeDirection =
      data.fromEnd === "arrow" && data.toEnd === "arrow" ? "both" : data.toEnd === "arrow" || data.fromEnd === "arrow" ? "oneway" : "none";
    const dirItem = (value: EdgeDirection, label: string) => (
      <Item onClick={run(() => store.setEdgeDirection(edge.id, value))}>
        <span>{label}</span>
        {direction === value ? <span className="text-xs text-zinc-400">✓</span> : null}
      </Item>
    );
    content = (
      <>
        <Item onClick={run(() => ui.setEditingEdge(edge.id))}>
          {data.label ? "Edit label" : "Add label"} <Hint>Enter</Hint>
        </Item>
        <Separator />
        <div className="px-2 pb-1 pt-1 text-[11px] uppercase tracking-wide text-zinc-400">Direction</div>
        {dirItem("oneway", "One way →")}
        {dirItem("both", "Both ways ↔")}
        {dirItem("none", "No arrows —")}
        <Separator />
        <div className="px-2 py-1.5">
          <ColorPicker value={data.color} onPick={(c) => run(() => store.setEdgesColor([edge.id], c))()} />
        </div>
        <Separator />
        <Item danger onClick={run(() => store.removeEdges([edge.id]))}>
          Delete <Hint>⌫</Hint>
        </Item>
      </>
    );
  }

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute z-30 min-w-48 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {content}
    </div>
  );
}
