import { describe, expect, it } from "vitest";

import { getHelperLines } from "./helper-lines";

describe("getHelperLines", () => {
  const others = [{ x: 100, y: 100, width: 200, height: 100 }];

  it("snaps left edges that nearly line up", () => {
    const lines = getHelperLines({ x: 103, y: 400, width: 50, height: 50 }, others);
    expect(lines.vertical).toBe(100);
    expect(lines.snapX).toBe(100);
    expect(lines.horizontal).toBeUndefined();
  });

  it("snaps right edge to another right edge", () => {
    const lines = getHelperLines({ x: 252, y: 400, width: 50, height: 50 }, others);
    expect(lines.vertical).toBe(300);
    expect(lines.snapX).toBe(250);
  });

  it("snaps centres", () => {
    const lines = getHelperLines({ x: 400, y: 127, width: 50, height: 50 }, others);
    expect(lines.horizontal).toBe(150);
    expect(lines.snapY).toBe(125);
  });

  it("returns nothing when far away", () => {
    expect(getHelperLines({ x: 900, y: 900, width: 50, height: 50 }, others)).toEqual({});
  });
});
