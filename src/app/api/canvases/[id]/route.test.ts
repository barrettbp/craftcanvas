import { beforeEach, describe, expect, it, vi } from "vitest";

import { emptyCanvas } from "@/lib/canvas/schema";

const { authMock, repo } = vi.hoisted(() => ({
  authMock: vi.fn(),
  repo: {
    getCanvasForUser: vi.fn(),
    saveCanvasIfVersion: vi.fn(),
    renameCanvasForUser: vi.fn(),
    deleteCanvasForUser: vi.fn(),
  },
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock() }));
vi.mock("@/lib/canvas/repo", () => repo);

import { DELETE, GET, PATCH, PUT } from "./route";

const ID = "6f1e4c1a-6a0b-4c3e-9a0e-0d7b7d1f9a11";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

const row = {
  id: ID,
  userId: "user_1",
  title: "Plan",
  data: emptyCanvas(),
  version: 3,
  thumbnail: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};

function put(body: unknown, id = ID) {
  const req = new Request(`http://test/api/canvases/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return PUT(req, ctx(id));
}

describe("PUT /api/canvases/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
  });

  it("returns 401 when signed out", async () => {
    authMock.mockResolvedValue({ userId: null });
    const res = await put({ data: emptyCanvas(), version: 3 });
    expect(res.status).toBe(401);
    expect(repo.saveCanvasIfVersion).not.toHaveBeenCalled();
  });

  it("returns 404 for a non uuid id without touching the database", async () => {
    const res = await put({ data: emptyCanvas(), version: 3 }, "nope");
    expect(res.status).toBe(404);
    expect(repo.saveCanvasIfVersion).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid body", async () => {
    const res = await put({ data: { nodes: [{ id: "x" }] }, version: 3 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
  });

  it("saves and returns the bumped version when the version matches", async () => {
    repo.saveCanvasIfVersion.mockResolvedValue({ ...row, version: 4 });
    const res = await put({ data: emptyCanvas(), version: 3 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: 4, updatedAt: "2026-01-02T00:00:00.000Z" });
    expect(repo.saveCanvasIfVersion).toHaveBeenCalledWith("user_1", ID, emptyCanvas(), 3);
  });

  it("returns 409 with the current version when another tab saved first", async () => {
    repo.saveCanvasIfVersion.mockResolvedValue(null);
    repo.getCanvasForUser.mockResolvedValue({ ...row, version: 5 });
    const res = await put({ data: emptyCanvas(), version: 3 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "version_conflict", version: 5 });
  });

  it("returns 404 when the canvas is missing or owned by someone else", async () => {
    repo.saveCanvasIfVersion.mockResolvedValue(null);
    repo.getCanvasForUser.mockResolvedValue(null);
    const res = await put({ data: emptyCanvas(), version: 3 });
    expect(res.status).toBe(404);
  });
});

describe("GET / PATCH / DELETE /api/canvases/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
  });

  it("GET returns the document for the owner and 404 otherwise", async () => {
    repo.getCanvasForUser.mockResolvedValue(row);
    const ok = await GET(new Request("http://test"), ctx());
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ id: ID, title: "Plan", version: 3, data: emptyCanvas() });
    expect(repo.getCanvasForUser).toHaveBeenCalledWith("user_1", ID);

    repo.getCanvasForUser.mockResolvedValue(null);
    const missing = await GET(new Request("http://test"), ctx());
    expect(missing.status).toBe(404);
  });

  it("GET returns 401 when signed out", async () => {
    authMock.mockResolvedValue({ userId: null });
    const res = await GET(new Request("http://test"), ctx());
    expect(res.status).toBe(401);
  });

  it("PATCH renames with a trimmed title", async () => {
    repo.renameCanvasForUser.mockResolvedValue({ ...row, title: "New name" });
    const req = new Request("http://test", { method: "PATCH", body: JSON.stringify({ title: "  New name " }) });
    const res = await PATCH(req, ctx());
    expect(res.status).toBe(200);
    expect(repo.renameCanvasForUser).toHaveBeenCalledWith("user_1", ID, "New name");
    expect((await res.json()).title).toBe("New name");
  });

  it("PATCH rejects an empty title", async () => {
    const req = new Request("http://test", { method: "PATCH", body: JSON.stringify({ title: " " }) });
    expect((await PATCH(req, ctx())).status).toBe(400);
  });

  it("DELETE returns ok for the owner and 404 otherwise", async () => {
    repo.deleteCanvasForUser.mockResolvedValue(true);
    expect((await DELETE(new Request("http://test"), ctx())).status).toBe(200);
    repo.deleteCanvasForUser.mockResolvedValue(false);
    expect((await DELETE(new Request("http://test"), ctx())).status).toBe(404);
  });
});
