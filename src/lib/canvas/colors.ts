/**
 * Colour presets (spec 8.4). JSON Canvas preset ids "1" to "6" map to red,
 * orange, yellow, green, cyan, purple. Custom hex values are accepted in the
 * data model; the picker only shows presets in v1.
 */

export type PresetColorId = "1" | "2" | "3" | "4" | "5" | "6";

export const PRESET_COLORS: ReadonlyArray<{ id: PresetColorId; name: string; hex: string }> = [
  { id: "1", name: "Red", hex: "#e03e3e" },
  { id: "2", name: "Orange", hex: "#e8871e" },
  { id: "3", name: "Yellow", hex: "#e0b317" },
  { id: "4", name: "Green", hex: "#2f9e5a" },
  { id: "5", name: "Cyan", hex: "#1aa0c4" },
  { id: "6", name: "Purple", hex: "#8a5cf6" },
];

const byId = new Map(PRESET_COLORS.map((c) => [c.id, c.hex]));

export function isPresetColor(color: string | undefined): color is PresetColorId {
  return color !== undefined && byId.has(color as PresetColorId);
}

/** Resolves a preset id or hex string to a CSS colour; `undefined` for "no colour". */
export function resolveColor(color: string | undefined | null): string | undefined {
  if (!color) return undefined;
  return byId.get(color as PresetColorId) ?? color;
}

/** Default stroke colour for edges and borders when no colour is set. */
export const NEUTRAL_STROKE = "#71717a";

/** Low opacity fill for groups and tinted cards. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
