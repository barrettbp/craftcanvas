import { nanoid } from "nanoid";
import { z } from "zod";

import type { CanvasData, CanvasEdge, CanvasNode } from "./types";

const PRESET_COLOR_RE = /^[1-6]$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Preset id "1".."6" or a hex colour. */
export const colorSchema = z
  .string()
  .refine((v) => PRESET_COLOR_RE.test(v) || HEX_COLOR_RE.test(v), "Colour must be a preset id (1-6) or a hex colour");

export const nodeSideSchema = z.enum(["top", "right", "bottom", "left"]);
export const edgeEndSchema = z.enum(["none", "arrow"]);

const finite = z.number().finite();
const positive = z.number().finite().positive();

const baseNode = {
  id: z.string().min(1),
  x: finite,
  y: finite,
  width: positive,
  height: positive,
  color: colorSchema.optional(),
};

export const textNodeSchema = z.object({
  ...baseNode,
  type: z.literal("text"),
  text: z.string(),
  craftcanvas: z.object({ manualSize: z.boolean().optional() }).optional(),
});

export const fileNodeExtensionSchema = z.object({
  craftDocId: z.string().min(1),
  connectionId: z.string(),
  title: z.string(),
  folderPath: z.string().optional(),
  preview: z.string().optional(),
  indexedAt: z.string().optional(),
  missing: z.boolean().optional(),
  updatedAt: z.string().optional(),
  webUrl: z.string().optional(),
});

export const fileNodeSchema = z.object({
  ...baseNode,
  type: z.literal("file"),
  file: z.string(),
  subpath: z.string().optional(),
  craftcanvas: fileNodeExtensionSchema,
});

export const linkNodeSchema = z.object({
  ...baseNode,
  type: z.literal("link"),
  url: z.string(),
});

export const groupNodeSchema = z.object({
  ...baseNode,
  type: z.literal("group"),
  label: z.string().optional(),
  background: z.string().optional(),
  backgroundStyle: z.enum(["cover", "ratio", "repeat"]).optional(),
});

export const canvasNodeSchema = z.discriminatedUnion("type", [
  textNodeSchema,
  fileNodeSchema,
  linkNodeSchema,
  groupNodeSchema,
]);

export const canvasEdgeSchema = z.object({
  id: z.string().min(1),
  fromNode: z.string().min(1),
  fromSide: nodeSideSchema.optional(),
  fromEnd: edgeEndSchema.optional(),
  toNode: z.string().min(1),
  toSide: nodeSideSchema.optional(),
  toEnd: edgeEndSchema.optional(),
  color: colorSchema.optional(),
  label: z.string().optional(),
});

export const canvasViewportSchema = z.object({
  x: finite,
  y: finite,
  zoom: positive,
});

export const canvasExtensionSchema = z.object({
  viewport: canvasViewportSchema.optional(),
  grid: z.boolean().optional(),
});

/**
 * Validates a JSON Canvas document with the CraftCanvas extension. Unknown keys
 * are stripped. Node ids must be unique and every edge must reference nodes
 * that exist.
 */
export const canvasDataSchema: z.ZodType<CanvasData> = z
  .object({
    nodes: z.array(canvasNodeSchema).default([]),
    edges: z.array(canvasEdgeSchema).default([]),
    craftcanvas: canvasExtensionSchema.optional(),
  })
  .superRefine((data, ctx) => {
    const ids = new Set<string>();
    data.nodes.forEach((n, i) => {
      if (ids.has(n.id)) {
        ctx.addIssue({ code: "custom", path: ["nodes", i, "id"], message: `Duplicate node id "${n.id}"` });
      }
      ids.add(n.id);
    });
    const edgeIds = new Set<string>();
    data.edges.forEach((e, i) => {
      if (edgeIds.has(e.id)) {
        ctx.addIssue({ code: "custom", path: ["edges", i, "id"], message: `Duplicate edge id "${e.id}"` });
      }
      edgeIds.add(e.id);
      if (!ids.has(e.fromNode)) {
        ctx.addIssue({ code: "custom", path: ["edges", i, "fromNode"], message: `Unknown node "${e.fromNode}"` });
      }
      if (!ids.has(e.toNode)) {
        ctx.addIssue({ code: "custom", path: ["edges", i, "toNode"], message: `Unknown node "${e.toNode}"` });
      }
    });
  }) as unknown as z.ZodType<CanvasData>;

export type CanvasNodeInput = z.input<typeof canvasNodeSchema>;
export type CanvasEdgeInput = z.input<typeof canvasEdgeSchema>;

/** A new, empty canvas document. */
export function emptyCanvas(): CanvasData {
  return {
    nodes: [],
    edges: [],
    craftcanvas: { viewport: { x: 0, y: 0, zoom: 1 }, grid: true },
  };
}

/** Short, URL safe id for nodes and edges. */
export function newId(): string {
  return nanoid(10);
}

/** Parses unknown input into `CanvasData`, throwing a ZodError when invalid. */
export function parseCanvasData(input: unknown): CanvasData {
  return canvasDataSchema.parse(input);
}

/** Returns `CanvasData` when valid, otherwise `null`. */
export function safeParseCanvasData(input: unknown): CanvasData | null {
  const result = canvasDataSchema.safeParse(input);
  return result.success ? result.data : null;
}

export function isGroupNode(node: CanvasNode): node is Extract<CanvasNode, { type: "group" }> {
  return node.type === "group";
}

export function isEdgeBetween(edge: CanvasEdge, ids: ReadonlySet<string>): boolean {
  return ids.has(edge.fromNode) && ids.has(edge.toNode);
}
