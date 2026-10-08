"use client";

/**
 * Bottom toolbar (spec 8.1): text, note, group, arrow, colour, undo/redo,
 * zoom percent with plus and minus, minimap toggle and a settings menu
 * (snap to grid, minimap, notes panel).
 */
import { useReactFlow, useViewport } from "@xyflow/react";
import {
  ArrowRight,
  BoxSelect,
  FileText,
  Maximize2,
  Minus,
  Palette,
  PanelLeft,
  Plus,
  Redo2,
  Settings2,
  Type,
  Undo2,
  Map as MapIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { focusNotesSearch } from "@/hooks/useCanvasShortcuts";
import { DEFAULT_SIZES } from "@/lib/canvas/types";
import { useCanvasStore } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";

import { ColorPicker } from "./ColorPicker";

function ToolButton({
  label,
  shortcut,
  onClick,
  active,
  disabled,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-1.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-200 dark:hover:bg-zinc-800 ${
        active ? "bg-zinc-200 dark:bg-zinc-700" : ""
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />;
}

export function Toolbar({ containerRef }: { containerRef: React.RefObject<HTMLElement | null> }) {
  const rf = useReactFlow();
  const { zoom } = useViewport();
  const canUndo = useCanvasStore((s) => s.canUndo);
  const canRedo = useCanvasStore((s) => s.canRedo);
  const grid = useCanvasStore((s) => s.grid);
  const selection = useCanvasStore((s) => s.selection);
  const tool = useUiStore((s) => s.tool);
  const showMinimap = useUiStore((s) => s.showMinimap);
  const panelOpen = useUiStore((s) => s.panelOpen);
  const colorOpen = useUiStore((s) => s.colorPickerOpen);
  const setColorOpen = useUiStore((s) => s.setColorPickerOpen);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const hasSelection = selection.nodeIds.length > 0 || selection.edgeIds.length > 0;

  useEffect(() => {
    if (!colorOpen && !settingsOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setColorOpen(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [colorOpen, settingsOpen, setColorOpen]);

  const centre = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    return rf.screenToFlowPosition({ x, y });
  };

  const selectedColor = useCanvasStore((s) => {
    const node = s.nodes.find((n) => n.id === s.selection.nodeIds[0]);
    if (node) return (node.data as { color?: string }).color;
    const edge = s.edges.find((e) => e.id === s.selection.edgeIds[0]);
    return edge?.data?.color;
  });

  return (
    <div ref={barRef} className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
      <div className="pointer-events-auto relative flex items-center gap-0.5 rounded-xl border border-zinc-200 bg-white/95 px-1.5 py-1 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
        <ToolButton
          label="Text card"
          shortcut="T"
          active={tool === "text"}
          onClick={() => {
            const ui = useUiStore.getState();
            ui.setTool(ui.tool === "text" ? "select" : "text");
          }}
        >
          <Type className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Text</span>
        </ToolButton>
        <ToolButton label="Note from Craft" shortcut="N" onClick={() => focusNotesSearch()}>
          <FileText className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Note</span>
        </ToolButton>
        <ToolButton
          label="Group"
          shortcut="G"
          active={tool === "group"}
          onClick={() => {
            const store = useCanvasStore.getState();
            const ui = useUiStore.getState();
            if (store.selection.nodeIds.length > 0) store.wrapSelectionInGroup();
            else ui.setTool(ui.tool === "group" ? "select" : "group");
          }}
        >
          <BoxSelect className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Group</span>
        </ToolButton>
        <ToolButton
          label={selection.nodeIds.length === 2 ? "Connect selected cards" : "Arrow: select two cards, then connect"}
          shortcut="A"
          disabled={selection.nodeIds.length !== 2}
          onClick={() => useCanvasStore.getState().connectSelected()}
        >
          <ArrowRight className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Arrow</span>
        </ToolButton>
        <div className="relative">
          <ToolButton
            label="Colour"
            shortcut="C"
            active={colorOpen}
            disabled={!hasSelection}
            onClick={() => {
              setSettingsOpen(false);
              setColorOpen(!colorOpen);
            }}
          >
            <Palette className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Colour</span>
          </ToolButton>
          {colorOpen && hasSelection ? (
            <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <ColorPicker
                value={selectedColor}
                onPick={(c) => {
                  useCanvasStore.getState().setSelectionColor(c);
                  setColorOpen(false);
                }}
              />
            </div>
          ) : null}
        </div>
        <Divider />
        <ToolButton label="Undo" shortcut="⌘Z" disabled={!canUndo} onClick={() => useCanvasStore.getState().undo()}>
          <Undo2 className="h-4 w-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Redo" shortcut="⌘⇧Z" disabled={!canRedo} onClick={() => useCanvasStore.getState().redo()}>
          <Redo2 className="h-4 w-4" aria-hidden />
        </ToolButton>
        <Divider />
        <ToolButton label="Zoom out" shortcut="⌘-" onClick={() => void rf.zoomOut({ duration: 150 })}>
          <Minus className="h-4 w-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Reset zoom" shortcut="⌘0" onClick={() => void rf.zoomTo(1, { duration: 150 })}>
          <span className="w-10 tabular-nums">{Math.round(zoom * 100)}%</span>
        </ToolButton>
        <ToolButton label="Zoom in" shortcut="⌘+" onClick={() => void rf.zoomIn({ duration: 150 })}>
          <Plus className="h-4 w-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Fit all" shortcut="⇧1" onClick={() => void rf.fitView({ padding: 0.2, duration: 200 })}>
          <Maximize2 className="h-4 w-4" aria-hidden />
        </ToolButton>
        <Divider />
        <ToolButton label="Minimap" shortcut="M" active={showMinimap} onClick={() => useUiStore.getState().toggleMinimap()}>
          <MapIcon className="h-4 w-4" aria-hidden />
        </ToolButton>
        <ToolButton label="Notes panel" shortcut="[" active={panelOpen} onClick={() => useUiStore.getState().togglePanel()}>
          <PanelLeft className="h-4 w-4" aria-hidden />
        </ToolButton>
        <div className="relative">
          <ToolButton
            label="Settings"
            active={settingsOpen}
            onClick={() => {
              setColorOpen(false);
              setSettingsOpen(!settingsOpen);
            }}
          >
            <Settings2 className="h-4 w-4" aria-hidden />
          </ToolButton>
          {settingsOpen ? (
            <div className="absolute bottom-full right-0 mb-2 w-56 rounded-lg border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <label className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <span>Snap to 8px grid</span>
                <input type="checkbox" checked={grid} onChange={(e) => useCanvasStore.getState().setGrid(e.target.checked)} />
              </label>
              <label className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <span>Show minimap</span>
                <input type="checkbox" checked={showMinimap} onChange={() => useUiStore.getState().toggleMinimap()} />
              </label>
              <label className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <span>Notes panel</span>
                <input type="checkbox" checked={panelOpen} onChange={(e) => useUiStore.getState().setPanelOpen(e.target.checked)} />
              </label>
              <div className="my-1 border-t border-zinc-200 dark:border-zinc-700" />
              <button
                type="button"
                className="w-full rounded px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => {
                  const c = centre();
                  const id = useCanvasStore.getState().addTextNode({
                    x: c.x - DEFAULT_SIZES.text.width / 2,
                    y: c.y - DEFAULT_SIZES.text.height / 2,
                  });
                  useUiStore.getState().setEditingNode(id);
                  setSettingsOpen(false);
                }}
              >
                Add text card at centre
              </button>
              <p className="px-2 py-1.5 text-xs text-zinc-500">Hold Alt while dragging to ignore the grid.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
