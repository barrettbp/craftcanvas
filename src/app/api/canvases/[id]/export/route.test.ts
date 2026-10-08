import { beforeEach, describe, expect, it, vi } from "vitest";

import { canvasDataSchema, emptyCanvas } from "@/lib/canvas/schema";
import type { CanvasData } from "@/lib/canvas/types";

const { authMock, repo } = vi.hoisted(() => ({
  authMock: vi.fn(),
  repo: { getCanvasForUser: vi.fn() },
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock() }));
vi.mock("@/lib/canvas/repo", () => repo);

import { GET } from "./route";

const ID = "6f1e4c1a-6a0b-4c3e-9a0e-0d7b7d1f9a11";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

const data: CanvasData = {
  nodes: [
    {
      id: "n1",
      type: "file",
      x: 0,
      y: 0,
      width: 320,
      height: 200,
      file: "craft/Docs/Note.md",
      craftcanvas: { craftDocId: "doc1", connectionId: "c1", title: "Note" },
    },
    { id: "n2", type: "text", x: 400, y: 0, width: 240, height: 120, text: "hi" },
  ],
  edges: [{ id: "e1", fromNode: "n1", toNode: "n2" }],
  craftcanvas: { viewport: { x: 1, y: 2, zoom: 1.5 }, grid: false },
};

const row = {
  id: ID,
  userId: "user_1",
  title: "Q3 / plan",
  data,
  version: 3,
  thumbnail: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

describe("GET /api/canvases/:id/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
  });

  it("returns 401 when signed out", async () => {
    authMock.mockResolvedValue({ userId: null });
    const res = await GET(new Request("http://test"), ctx());
    expect(res.status).toBe(401);
    expect(repo.getCanvasForUser).not.toHaveBeenCalled();
  });

  it("returns 404 for a non uuid id without touching the database", async () => {
    const res = await GET(new Request("http://test"), ctx("nope"));
    expect(res.status).toBe(404);
    expect(repo.getCanvasForUser).not.toHaveBeenCalled();
  });

  it("returns 404 when the canvas is missing or owned by someone else", async () => {
    repo.getCanvasForUser.mockResolvedValue(null);
    const res = await GET(new Request("http://test"), ctx());
    expect(res.status).toBe(404);
    expect(repo.getCanvasForUser).toHaveBeenCalledWith("user_1", ID);
  });

  it("downloads the JSON Canvas file as an attachment", async () => {
    repo.getCanvasForUser.mockResolvedValue(row);
    const res = await GET(new Request("http://test"), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      "attachment; filename=\"Q3 - plan.canvas\"; filename*=UTF-8''Q3%20-%20plan.canvas",
    );

    const body = JSON.parse(await res.text());
    expect(Object.keys(body).sort()).toEqual(["craftcanvas", "edges", "nodes"]);
    expect(canvasDataSchema.safeParse(body).success).toBe(true);
    expect(body.nodes[0]).toMatchObject({ type: "file", file: "craft/Docs/Note.md", craftcanvas: { craftDocId: "doc1" } });
    expect(body.craftcanvas).toEqual({ viewport: { x: 1, y: 2, zoom: 1.5 }, grid: false });
  });

  it("repairs an unreadable stored document into an empty canvas", async () => {
    repo.getCanvasForUser.mockResolvedValue({ ...row, data: { nodes: "???" } });
    const res = await GET(new Request("http://test"), ctx());
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text())).toEqual(emptyCanvas());
  });
});
