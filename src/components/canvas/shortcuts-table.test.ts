import { describe, expect, it } from "vitest";

import { SHORTCUT_GROUPS, allShortcuts, formatKey, isMacPlatform } from "./shortcuts-table";

describe("shortcut table", () => {
  it("has the groups from spec 8.5 in order", () => {
    expect(SHORTCUT_GROUPS.map((g) => g.title)).toEqual(["Navigate", "Select", "Move", "Create and edit", "Undo and redo", "Panels"]);
  });

  it("every group has a title and at least one row", () => {
    for (const group of SHORTCUT_GROUPS) {
      expect(group.title.trim().length).toBeGreaterThan(0);
      expect(group.shortcuts.length).toBeGreaterThan(0);
    }
  });

  it("every row has a label and at least one non empty key chord", () => {
    const rows = allShortcuts();
    expect(rows.length).toBeGreaterThan(15);
    for (const row of rows) {
      expect(row.label.trim().length, `label of ${JSON.stringify(row)}`).toBeGreaterThan(0);
      expect(row.keys.length, `keys of ${row.label}`).toBeGreaterThan(0);
      for (const chord of row.keys) {
        expect(chord.trim().length, `chord of ${row.label}`).toBeGreaterThan(0);
        for (const part of formatKey(chord, false)) expect(part.length, `part of ${chord}`).toBeGreaterThan(0);
      }
    }
  });

  it("labels are unique", () => {
    const labels = allShortcuts().map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("lists the bindings implemented in useCanvasShortcuts", () => {
    const chords = new Set(allShortcuts().flatMap((r) => r.keys));
    for (const chord of ["Mod+Z", "Shift+Mod+Z", "Mod+A", "Mod+D", "Mod+K", "Mod+=", "Mod+-", "Mod+0", "Shift+1", "T", "G", "A", "M", "N", "C", "[", "?", "Delete", "Backspace", "Enter", "Escape"]) {
      expect(chords.has(chord), `missing ${chord}`).toBe(true);
    }
  });
});

describe("formatKey", () => {
  it("maps Mod to the platform modifier and keeps the rest", () => {
    expect(formatKey("Shift+Mod+Z", true)).toEqual(["⇧", "⌘", "Z"]);
    expect(formatKey("Shift+Mod+Z", false)).toEqual(["Shift", "Ctrl", "Z"]);
    expect(formatKey("Mod+-", false)).toEqual(["Ctrl", "-"]);
    expect(formatKey("Mod+=", true)).toEqual(["⌘", "="]);
    expect(formatKey("?", true)).toEqual(["?"]);
    expect(formatKey("Space+Drag", false)).toEqual(["Space", "Drag"]);
  });
});

describe("isMacPlatform", () => {
  it("detects Apple platforms and defaults to false without a navigator", () => {
    expect(isMacPlatform({ platform: "MacIntel" })).toBe(true);
    expect(isMacPlatform({ platform: "", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" })).toBe(true);
    expect(isMacPlatform({ platform: "Win32" })).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });
});
