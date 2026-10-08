import type { NodeSide } from "./types";

export type Rect = { x: number; y: number; width: number; height: number };

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function rectArea(r: Rect): number {
  return r.width * r.height;
}

export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function padRect(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
}

export function rectCenter(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function snapToGrid(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

/**
 * Picks the pair of sides that best connects two rectangles: horizontal when
 * the centres are further apart on the x axis, vertical otherwise.
 */
export function pickSides(from: Rect, to: Rect): { fromSide: NodeSide; toSide: NodeSide } {
  const a = rectCenter(from);
  const b = rectCenter(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { fromSide: "right", toSide: "left" } : { fromSide: "left", toSide: "right" };
  }
  return dy >= 0 ? { fromSide: "bottom", toSide: "top" } : { fromSide: "top", toSide: "bottom" };
}

export function oppositeSide(side: NodeSide): NodeSide {
  switch (side) {
    case "top":
      return "bottom";
    case "bottom":
      return "top";
    case "left":
      return "right";
    case "right":
      return "left";
  }
}
