import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FlowNode } from "@/lib/canvas/convert";

const { toPng } = vi.hoisted(() => ({ toPng: vi.fn() }));
vi.mock("html-to-image", () => ({ toPng }));

import { captureViewport, contentBounds, fitToContent } from "./capture";
import { exportCanvasPng, pngFilenameFor } from "./png";
import { fitsThumbnailLimit, renderThumbnail, THUMBNAIL_HEIGHT, THUMBNAIL_WIDTH } from "./thumbnail";

const text = (id: string, x: number, y: number, width = 240, height = 120, parentId?: string): FlowNode => ({
  id,
  type: "text",
  position: { x, y },
  width,
  height,
  data: { text: id },
  ...(parentId ? { parentId } : {}),
});

describe("contentBounds", () => {
  it("is null for an empty canvas", () => {
    expect(contentBounds([])).toBeNull();
  });

  it("encloses every node, resolving parent relative positions", () => {
    const group: FlowNode = { id: "g", type: "group", position: { x: 100, y: 100 }, width: 500, height: 400, data: {} };
    const bounds = contentBounds([group, text("a", 10, 20, 100, 50, "g"), text("b", -200, -100, 50, 50)]);
    expect(bounds).toEqual({ x: -200, y: -100, width: 800, height: 600 });
  });

  it("uses measured sizes for auto grown cards", () => {
    const node: FlowNode = { id: "a", type: "text", position: { x: 0, y: 0 }, width: 240, measured: { width: 240, height: 90 }, data: { text: "" } };
    expect(contentBounds([node])).toEqual({ x: 0, y: 0, width: 240, height: 90 });
  });
});

describe("fitToContent", () => {
  const bounds = { x: 100, y: 50, width: 800, height: 400 };

  it("sizes the image to the content plus padding at zoom 1", () => {
    const fit = fitToContent(bounds, { padding: 0.1 });
    expect(fit.width).toBe(1000);
    expect(fit.height).toBe(500);
    expect(fit.viewport.zoom).toBeCloseTo(1, 5);
    // Content centred: left edge lands at 10% of the width.
    expect(fit.viewport.x + bounds.x * fit.viewport.zoom).toBeCloseTo(100, 3);
    expect(fit.viewport.y + bounds.y * fit.viewport.zoom).toBeCloseTo(50, 3);
  });

  it("letterboxes into a fixed box", () => {
    const fit = fitToContent(bounds, { width: 480, height: 300, padding: 0.1 });
    expect(fit.width).toBe(480);
    expect(fit.height).toBe(300);
    expect(fit.viewport.zoom).toBeCloseTo((480 * 0.8) / 800, 5);
    const left = fit.viewport.x + bounds.x * fit.viewport.zoom;
    const right = left + bounds.width * fit.viewport.zoom;
    expect(left).toBeCloseTo(48, 3);
    expect(right).toBeCloseTo(432, 3);
  });

  it("caps huge canvases at maxDimension and zooms out instead", () => {
    const fit = fitToContent({ x: 0, y: 0, width: 40_000, height: 10_000 }, { padding: 0, maxDimension: 4000 });
    expect(fit.width).toBe(4000);
    expect(fit.height).toBe(1000);
    expect(fit.viewport.zoom).toBeCloseTo(0.1, 5);
  });

  it("does not zoom in beyond maxZoom on tiny content", () => {
    const fit = fitToContent({ x: 0, y: 0, width: 10, height: 10 }, { width: 480, height: 300, padding: 0.1, maxZoom: 1.5 });
    expect(fit.viewport.zoom).toBe(1.5);
  });
});

describe("captureViewport and friends", () => {
  const element = { closest: () => null } as unknown as HTMLElement;
  const bounds = { x: 0, y: 0, width: 800, height: 400 };

  beforeEach(() => {
    toPng.mockReset();
    toPng.mockResolvedValue("data:image/png;base64,iVBORw0KGgo=");
  });

  it("passes size, transform, pixel ratio and background to html-to-image", async () => {
    await captureViewport({ element, nodesBounds: bounds, pixelRatio: 2, background: "#123456", fit: { padding: 0 } });
    expect(toPng).toHaveBeenCalledTimes(1);
    const [el, opts] = toPng.mock.calls[0];
    expect(el).toBe(element);
    expect(opts).toMatchObject({ width: 800, height: 400, pixelRatio: 2, backgroundColor: "#123456" });
    expect(opts.style).toEqual({ width: "800px", height: "400px", transform: "translate(0px, 0px) scale(1)" });
  });

  it("exportCanvasPng renders at 2x by default", async () => {
    const url = await exportCanvasPng({ element, nodesBounds: bounds });
    expect(url.startsWith("data:image/png")).toBe(true);
    expect(toPng.mock.calls[0][1]).toMatchObject({ pixelRatio: 2, backgroundColor: "#ffffff" });
    expect(pngFilenameFor("My / board")).toBe("My - board.png");
  });

  it("renderThumbnail renders a 480x300 image at 1x", async () => {
    await renderThumbnail({ element, nodesBounds: bounds });
    expect(toPng.mock.calls[0][1]).toMatchObject({ width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT, pixelRatio: 1 });
    expect(THUMBNAIL_WIDTH).toBeLessThanOrEqual(480);
  });

  it("fitsThumbnailLimit checks the decoded size", () => {
    expect(fitsThumbnailLimit("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(fitsThumbnailLimit(`data:image/png;base64,${"A".repeat(600 * 1024)}`)).toBe(false);
    expect(fitsThumbnailLimit("nope")).toBe(false);
  });
});
