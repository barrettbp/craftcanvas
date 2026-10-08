/**
 * Alignment guides ("helper lines"). While a node is dragged, its edges and
 * centre are compared with every other node; when one lines up within
 * `threshold` canvas pixels the dragged node snaps to it and a line is shown.
 */
import type { Rect } from "./geometry";

export type HelperLines = {
  /** y coordinate of a horizontal guide, in canvas space. */
  horizontal?: number;
  /** x coordinate of a vertical guide, in canvas space. */
  vertical?: number;
  /** Position the dragged node should snap to (top left corner). */
  snapX?: number;
  snapY?: number;
};

export function getHelperLines(dragged: Rect, others: Rect[], threshold = 5): HelperLines {
  const result: HelperLines = {};
  let bestV = threshold;
  let bestH = threshold;

  const dLeft = dragged.x;
  const dRight = dragged.x + dragged.width;
  const dCx = dragged.x + dragged.width / 2;
  const dTop = dragged.y;
  const dBottom = dragged.y + dragged.height;
  const dCy = dragged.y + dragged.height / 2;

  for (const o of others) {
    const oLeft = o.x;
    const oRight = o.x + o.width;
    const oCx = o.x + o.width / 2;
    const oTop = o.y;
    const oBottom = o.y + o.height;
    const oCy = o.y + o.height / 2;

    const vertical: Array<[number, number, number]> = [
      // [distance, guide x, snapped node x]
      [Math.abs(dLeft - oLeft), oLeft, oLeft],
      [Math.abs(dRight - oRight), oRight, oRight - dragged.width],
      [Math.abs(dLeft - oRight), oRight, oRight],
      [Math.abs(dRight - oLeft), oLeft, oLeft - dragged.width],
      [Math.abs(dCx - oCx), oCx, oCx - dragged.width / 2],
    ];
    for (const [dist, guide, snap] of vertical) {
      if (dist < bestV) {
        bestV = dist;
        result.vertical = guide;
        result.snapX = snap;
      }
    }

    const horizontal: Array<[number, number, number]> = [
      [Math.abs(dTop - oTop), oTop, oTop],
      [Math.abs(dBottom - oBottom), oBottom, oBottom - dragged.height],
      [Math.abs(dTop - oBottom), oBottom, oBottom],
      [Math.abs(dBottom - oTop), oTop, oTop - dragged.height],
      [Math.abs(dCy - oCy), oCy, oCy - dragged.height / 2],
    ];
    for (const [dist, guide, snap] of horizontal) {
      if (dist < bestH) {
        bestH = dist;
        result.horizontal = guide;
        result.snapY = snap;
      }
    }
  }

  return result;
}
