/**
 * The keyboard map shown by the `?` modal (spec 8.5). Pure data plus two
 * formatting helpers so the table can be unit tested without React.
 *
 * Every row is implemented either in `src/hooks/useCanvasShortcuts.ts` or by
 * React Flow props in `Canvas.tsx` (Space to pan, Shift to marquee, Cmd/Ctrl
 * scroll to zoom). When you add a binding, add its row here; do not list
 * anything that is not wired.
 *
 * Key syntax: `Mod` is ⌘ on macOS and Ctrl elsewhere, `+` joins keys pressed
 * together, and the `keys` array lists alternatives.
 */

export type Shortcut = {
  label: string;
  /** Alternatives, each a `+` joined chord such as "Shift+Mod+Z". */
  keys: string[];
  /** The mouse / trackpad side of the interactions table, when there is one. */
  mouse?: string;
  note?: string;
};

export type ShortcutGroup = { title: string; shortcuts: Shortcut[] };

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Navigate",
    shortcuts: [
      {
        label: "Pan",
        keys: ["Space+Drag", "Arrow keys"],
        mouse: "Drag empty space, or two finger scroll",
        note: "Arrows pan when nothing is selected. Hold Shift to pan further.",
      },
      { label: "Zoom in", keys: ["Mod+="], mouse: "Pinch, or Mod+scroll" },
      { label: "Zoom out", keys: ["Mod+-"] },
      { label: "Reset zoom to 100%", keys: ["Mod+0"] },
      { label: "Fit all cards in view", keys: ["Shift+1"] },
    ],
  },
  {
    title: "Select",
    shortcuts: [
      { label: "Select all", keys: ["Mod+A"], mouse: "Click. Shift click to add, Shift drag for a marquee" },
      { label: "Clear selection, cancel the tool, close menus", keys: ["Escape"] },
    ],
  },
  {
    title: "Move",
    shortcuts: [
      { label: "Nudge selection by 1px", keys: ["Arrow keys"], mouse: "Drag the selection" },
      { label: "Nudge selection by 10px", keys: ["Shift+Arrow keys"], note: "Hold Alt while dragging to ignore the grid." },
    ],
  },
  {
    title: "Create and edit",
    shortcuts: [
      { label: "New text card at the centre", keys: ["T"], mouse: "Double click empty space" },
      { label: "New group, or wrap the selection in a group", keys: ["G"], mouse: "Toolbar, then drag a rectangle" },
      { label: "Connect the two selected cards with an arrow", keys: ["A"], mouse: "Drag from a card's side handle" },
      { label: "Edit the selected card or arrow label", keys: ["Enter"], mouse: "Double click" },
      { label: "Colour the selection", keys: ["C"] },
      { label: "Duplicate", keys: ["Mod+D"], mouse: "Alt drag" },
      { label: "Delete", keys: ["Delete", "Backspace"], mouse: "Right click, then Delete" },
    ],
  },
  {
    title: "Undo and redo",
    shortcuts: [
      { label: "Undo", keys: ["Mod+Z"] },
      { label: "Redo", keys: ["Shift+Mod+Z", "Mod+Y"] },
    ],
  },
  {
    title: "Panels",
    shortcuts: [
      { label: "Toggle the notes panel", keys: ["["] },
      { label: "Search notes", keys: ["Mod+K", "N"] },
      { label: "Toggle the minimap", keys: ["M"] },
      { label: "Show this keyboard map", keys: ["?"] },
    ],
  },
];

/** Flat list of every row, in display order. */
export function allShortcuts(): Shortcut[] {
  return SHORTCUT_GROUPS.flatMap((g) => g.shortcuts);
}

const MAC_GLYPHS: Record<string, string> = { Mod: "⌘", Shift: "⇧", Alt: "⌥", Enter: "↩", Escape: "esc", Backspace: "⌫", Delete: "⌦" };
const OTHER_GLYPHS: Record<string, string> = { Mod: "Ctrl", Escape: "Esc" };

/** Splits a chord into the key caps to render, mapping `Mod` and friends for the platform. */
export function formatKey(chord: string, isMac: boolean): string[] {
  const glyphs = isMac ? MAC_GLYPHS : OTHER_GLYPHS;
  return chord
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => glyphs[part] ?? part);
}

/** True on macOS and iOS, where `Mod` is ⌘. Safe to call without a navigator. */
export function isMacPlatform(nav: { platform?: string; userAgent?: string } | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  if (!nav) return false;
  const haystack = `${nav.platform ?? ""} ${nav.userAgent ?? ""}`;
  return /Mac|iPhone|iPad|iPod/i.test(haystack);
}
