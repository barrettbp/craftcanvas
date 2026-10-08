/**
 * Ephemeral UI state for the canvas page: nothing in here is saved. Kept out
 * of the canvas store so editing flags and menus never mark the document dirty.
 */
import { create } from "zustand";

import type { HelperLines } from "@/lib/canvas/helper-lines";

export type Tool = "select" | "text" | "group";

export type ContextMenuState =
  | { kind: "pane"; x: number; y: number; flow: { x: number; y: number } }
  | { kind: "node"; x: number; y: number; id: string }
  | { kind: "edge"; x: number; y: number; id: string };

/** What the canvas page knows about the user's Craft connection (from `/api/craft/status` and preview calls). */
export type CraftUiStatus = {
  /** Null until the status call answers or when the user has no connection. */
  connectionId: string | null;
  spaceId: string | null;
  /** True when Craft rejected the key: the reconnect banner shows. */
  unauthorized: boolean;
};

export type UiStore = {
  tool: Tool;
  editingNodeId: string | null;
  editingEdgeId: string | null;
  showMinimap: boolean;
  panelOpen: boolean;
  contextMenu: ContextMenuState | null;
  helperLines: HelperLines;
  altHeld: boolean;
  colorPickerOpen: boolean;
  craft: CraftUiStatus;
  /** Craft document ids whose preview is being fetched (note cards shimmer). */
  loadingPreviews: Record<string, true>;

  setCraftStatus: (patch: Partial<CraftUiStatus>) => void;
  setPreviewLoading: (docId: string, loading: boolean) => void;
  setTool: (tool: Tool) => void;
  setEditingNode: (id: string | null) => void;
  setEditingEdge: (id: string | null) => void;
  toggleMinimap: () => void;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  openContextMenu: (menu: ContextMenuState) => void;
  closeContextMenu: () => void;
  setHelperLines: (lines: HelperLines) => void;
  setAltHeld: (held: boolean) => void;
  setColorPickerOpen: (open: boolean) => void;
  /** Clears per canvas state (editing, menus, tool) when another canvas loads. */
  resetTransient: () => void;
};

export const useUiStore = create<UiStore>()((set) => ({
  tool: "select",
  editingNodeId: null,
  editingEdgeId: null,
  showMinimap: true,
  panelOpen: true,
  contextMenu: null,
  helperLines: {},
  altHeld: false,
  colorPickerOpen: false,
  craft: { connectionId: null, spaceId: null, unauthorized: false },
  loadingPreviews: {},

  setCraftStatus: (patch) => set((s) => ({ craft: { ...s.craft, ...patch } })),
  setPreviewLoading: (docId, loading) =>
    set((s) => {
      if (Boolean(s.loadingPreviews[docId]) === loading) return s;
      const next = { ...s.loadingPreviews };
      if (loading) next[docId] = true;
      else delete next[docId];
      return { loadingPreviews: next };
    }),
  setTool: (tool) => set({ tool }),
  setEditingNode: (editingNodeId) => set({ editingNodeId }),
  setEditingEdge: (editingEdgeId) => set({ editingEdgeId }),
  toggleMinimap: () => set((s) => ({ showMinimap: !s.showMinimap })),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  openContextMenu: (contextMenu) => set({ contextMenu }),
  closeContextMenu: () => set((s) => (s.contextMenu ? { contextMenu: null } : s)),
  setHelperLines: (helperLines) =>
    set((s) =>
      s.helperLines.horizontal === helperLines.horizontal && s.helperLines.vertical === helperLines.vertical ? s : { helperLines },
    ),
  setAltHeld: (altHeld) => set((s) => (s.altHeld === altHeld ? s : { altHeld })),
  setColorPickerOpen: (colorPickerOpen) => set({ colorPickerOpen }),
  resetTransient: () =>
    set({
      tool: "select",
      editingNodeId: null,
      editingEdgeId: null,
      contextMenu: null,
      helperLines: {},
      altHeld: false,
      colorPickerOpen: false,
      loadingPreviews: {},
    }),
}));
