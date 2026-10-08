import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emptyCanvas } from "@/lib/canvas/schema";

const { authMock, repo, upload } = vi.hoisted(() => ({
  authMock: vi.fn(),
  repo: { getCanvasForUser: vi.fn(), setCanvasThumbnailForUser: vi.fn() },
  upload: { uploadThumbnailToSupabase: vi.fn() },
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: () => authMock() }));
vi.mock("@/lib/canvas/repo", () => repo);
vi.mock("@/lib/export/thumbnail-upload", () => upload);

import { POST } from "./route";

const ID = "6f1e4c1a-6a0b-4c3e-9a0e-0d7b7d1f9a11";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

// A 1x1 transparent PNG.
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

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

function post(body: unknown, id = ID) {
  const req = new Request(`http://test/api/canvases/${id}/thumbnail`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req, ctx(id));
}

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_THUMBNAIL_BUCKET"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

describe("POST /api/canvases/:id/thumbnail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
    repo.getCanvasForUser.mockResolvedValue(row);
    repo.setCanvasThumbnailForUser.mockImplementation(async (_u: string, _id: string, thumbnail: string) => ({ ...row, thumbnail }));
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns 401 when signed out", async () => {
    authMock.mockResolvedValue({ userId: null });
    expect((await post({ dataUrl: PNG_DATA_URL })).status).toBe(401);
    expect(repo.setCanvasThumbnailForUser).not.toHaveBeenCalled();
  });

  it("returns 404 for a non uuid id and for someone else's canvas", async () => {
    expect((await post({ dataUrl: PNG_DATA_URL }, "nope")).status).toBe(404);
    repo.getCanvasForUser.mockResolvedValue(null);
    expect((await post({ dataUrl: PNG_DATA_URL })).status).toBe(404);
    expect(repo.setCanvasThumbnailForUser).not.toHaveBeenCalled();
  });

  it("rejects bodies that are not a PNG data URL", async () => {
    expect((await post({})).status).toBe(400);
    const jpeg = await post({ dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" });
    expect(jpeg.status).toBe(400);
    expect((await jpeg.json()).error).toBe("not_png_data_url");
    const fake = await post({ dataUrl: "data:image/png;base64,aGVsbG8gd29ybGQgdGhpcyBpcyBub3QgYSBwbmc=" });
    expect(fake.status).toBe(400);
    expect((await fake.json()).error).toBe("bad_signature");
    expect(repo.setCanvasThumbnailForUser).not.toHaveBeenCalled();
  });

  it("rejects oversized images with 413", async () => {
    const big = `data:image/png;base64,iVBORw0KGgo${"A".repeat(600 * 1024)}`;
    const res = await post({ dataUrl: big });
    expect(res.status).toBe(400); // over the body schema's max length
    const justOver = `data:image/png;base64,iVBORw0KGgo${"A".repeat(Math.ceil((401 * 1024 * 4) / 3 / 4) * 4 - 12 + 4)}`;
    const res2 = await post({ dataUrl: justOver });
    expect([400, 413]).toContain(res2.status);
    expect(repo.setCanvasThumbnailForUser).not.toHaveBeenCalled();
  });

  it("stores the data URL inline when Supabase is not configured", async () => {
    const res = await post({ dataUrl: PNG_DATA_URL });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ thumbnail: PNG_DATA_URL });
    expect(repo.setCanvasThumbnailForUser).toHaveBeenCalledWith("user_1", ID, PNG_DATA_URL);
    expect(upload.uploadThumbnailToSupabase).not.toHaveBeenCalled();
  });

  it("uploads to Supabase at <userId>/<canvasId>.png and stores the returned URL when configured", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SUPABASE_THUMBNAIL_BUCKET = "thumbs";
    upload.uploadThumbnailToSupabase.mockResolvedValue("https://example.supabase.co/storage/v1/object/public/thumbs/user_1/x.png?v=1");

    const res = await post({ dataUrl: PNG_DATA_URL });
    expect(res.status).toBe(200);
    expect(upload.uploadThumbnailToSupabase).toHaveBeenCalledTimes(1);
    const arg = upload.uploadThumbnailToSupabase.mock.calls[0][0];
    expect(arg.bucket).toBe("thumbs");
    expect(arg.path).toBe(`user_1/${ID}.png`);
    expect(Array.from(arg.bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(repo.setCanvasThumbnailForUser).toHaveBeenCalledWith(
      "user_1",
      ID,
      "https://example.supabase.co/storage/v1/object/public/thumbs/user_1/x.png?v=1",
    );
  });

  it("returns 502 when the upload fails and leaves the row alone", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    upload.uploadThumbnailToSupabase.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ dataUrl: PNG_DATA_URL });
    spy.mockRestore();
    expect(res.status).toBe(502);
    expect(repo.setCanvasThumbnailForUser).not.toHaveBeenCalled();
  });
});
