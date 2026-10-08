"use client";

/**
 * Keyboard side of the interactions table (spec 8.5). Must be used inside a
 * `ReactFlowProvider`.
 */
import { useReactFlow } from "@xyflow/react";
import { useEffect, type RefObject } from "react";

import { useCanvasStore } from "@/store/canvas-store";
import { useUiStore } from "@/store/ui-store";

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Focuses the notes search input when the panel slot renders one. */
export function focusNotesSearch(): void {
  useUiStore.getState().setPanelOpen(true);
  // The panel may have just opened, so look for the input on the next frame.
  requestAnimationFrame(() => {
    const el =
      document.querySelector<HTMLInputElement>("[data-notes-search]") ??
      document.querySelector<HTMLInputElement>("[data-notes-panel] input");
    el?.focus();
    el?.select?.();
  });
}

export function useCanvasShortcuts(containerRef: RefObject<HTMLElement | null>) {
  const rf = useReactFlow();

  useEffect(() => {
    const centre = () => {
      const el = containerRef.current;
      const rect = el?.getBoundingClientRect();
      const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      return rf.screenToFlowPosition({ x, y });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const store = useCanvasStore.getState();
      const ui = useUiStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;

      if (key === "Alt") ui.setAltHeld(true);

      if (isEditableTarget(e.target)) return;
      if (ui.editingNodeId || ui.editingEdgeId) return;

      // Undo / redo
      if (mod && (key === "z" || key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && (key === "y" || key === "Y")) {
        e.preventDefault();
        store.redo();
        return;
      }
      if (mod && (key === "a" || key === "A")) {
        e.preventDefault();
        store.selectAll();
        return;
      }
      if (mod && (key === "d" || key === "D")) {
        e.preventDefault();
        store.duplicateSelected();
        return;
      }
      if (mod && (key === "k" || key === "K")) {
        e.preventDefault();
        focusNotesSearch();
        return;
      }
      if (mod && (key === "=" || key === "+")) {
        e.preventDefault();
        void rf.zoomIn({ duration: 150 });
        return;
      }
      if (mod && (key === "-" || key === "_")) {
        e.preventDefault();
        void rf.zoomOut({ duration: 150 });
        return;
      }
      if (mod && key === "0") {
        e.preventDefault();
        void rf.zoomTo(1, { duration: 150 });
        return;
      }
      if (e.shiftKey && !mod && (key === "1" || key === "!")) {
        e.preventDefault();
        void rf.fitView({ padding: 0.2, duration: 200 });
        return;
      }
      if (mod) return;

      switch (key) {
        case "Delete":
        case "Backspace":
          e.preventDefault();
          store.removeSelected();
          return;
        case "Escape":
          ui.closeContextMenu();
          ui.setColorPickerOpen(false);
          if (ui.tool !== "select") ui.setTool("select");
          else store.clearSelection();
          return;
        case "Enter": {
          const sel = store.selection;
          if (sel.nodeIds.length === 1 && sel.edgeIds.length === 0) {
            const node = store.nodes.find((n) => n.id === sel.nodeIds[0]);
            if (node && (node.type === "text" || node.type === "group")) {
              e.preventDefault();
              ui.setEditingNode(node.id);
            }
          } else if (sel.edgeIds.length === 1 && sel.nodeIds.length === 0) {
            e.preventDefault();
            ui.setEditingEdge(sel.edgeIds[0]);
          }
          return;
        }
        case "t":
        case "T": {
          e.preventDefault();
          const c = centre();
          const size = { width: 240, height: 120 };
          const id = store.addTextNode({ x: c.x - size.width / 2, y: c.y - size.height / 2 });
          ui.setEditingNode(id);
          return;
        }
        case "g":
        case "G":
          e.preventDefault();
          if (store.selection.nodeIds.length > 0) store.wrapSelectionInGroup();
          else ui.setTool(ui.tool === "group" ? "select" : "group");
          return;
        case "a":
        case "A":
          e.preventDefault();
          store.connectSelected();
          return;
        case "m":
        case "M":
          e.preventDefault();
          ui.toggleMinimap();
          return;
        case "n":
        case "N":
          e.preventDefault();
          focusNotesSearch();
          return;
        case "c":
        case "C":
          if (store.selection.nodeIds.length > 0 || store.selection.edgeIds.length > 0) {
            e.preventDefault();
            ui.setColorPickerOpen(!ui.colorPickerOpen);
          }
          return;
        case "[":
          e.preventDefault();
          ui.togglePanel();
          return;
        case "ArrowUp":
        case "ArrowDown":
        case "ArrowLeft":
        case "ArrowRight": {
          e.preventDefault();
          const dx = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
          const dy = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
          if (store.selection.nodeIds.length > 0) {
            const step = e.shiftKey ? 10 : 1;
            store.nudgeSelected(dx * step, dy * step);
          } else {
            const step = e.shiftKey ? 200 : 50;
            const vp = rf.getViewport();
            void rf.setViewport({ ...vp, x: vp.x - dx * step, y: vp.y - dy * step });
          }
          return;
        }
        default:
          return;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") useUiStore.getState().setAltHeld(false);
      if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
        useCanvasStore.getState().breakCoalescing();
      }
    };
    const onBlur = () => useUiStore.getState().setAltHeld(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [rf, containerRef]);
}
