import { describe, expect, it } from "vitest";

import {
  coerceData,
  copyTitle,
  createCanvasBodySchema,
  decideVersion,
  isCanvasId,
  isOwnedBy,
  renameCanvasBodySchema,
  saveCanvasBodySchema,
  toDetail,
  toSummary,
} from "./api";
import { emptyCanvas } from "./schema";

describe("decideVersion", () => {
  it("accepts a matching version and bumps it", () => {
    expect(decideVersion(3, 3)).toEqual({ ok: true, nextVersion: 4 });
  });

  it("returns a 409 body when the stored version moved on", () => {
    expect(decideVersion(5, 3)).toEqual({ ok: false, status: 409, body: { error: "version_conflict", version: 5 } });
    expect(decideVersion(2, 3)).toEqual({ ok: false, status: 409, body: { error: "version_conflict", version: 2 } });
  });
});

describe("isOwnedBy", () => {
  it("is false for missing rows and other users", () => {
    expect(isOwnedBy(null, "u1")).toBe(false);
    expect(isOwnedBy(undefined, "u1")).toBe(false);
    expect(isOwnedBy({ userId: "u2" }, "u1")).toBe(false);
    expect(isOwnedBy({ userId: null }, "u1")).toBe(false);
  });
  it("is true for the owner", () => {
    expect(isOwnedBy({ userId: "u1" }, "u1")).toBe(true);
  });
});

describe("isCanvasId", () => {
  it("accepts uuids only", () => {
    expect(isCanvasId("6f1e4c1a-6a0b-4c3e-9a0e-0d7b7d1f9a11")).toBe(true);
    expect(isCanvasId(crypto.randomUUID())).toBe(true);
    expect(isCanvasId("not-a-uuid")).toBe(false);
    expect(isCanvasId("")).toBe(false);
    expect(isCanvasId(undefined)).toBe(false);
  });
});

describe("body schemas", () => {
  it("validates the save body", () => {
    expect(saveCanvasBodySchema.safeParse({ data: emptyCanvas(), version: 1 }).success).toBe(true);
    expect(saveCanvasBodySchema.safeParse({ data: emptyCanvas() }).success).toBe(false);
    expect(saveCanvasBodySchema.safeParse({ data: emptyCanvas(), version: 0 }).success).toBe(false);
    expect(saveCanvasBodySchema.safeParse({ data: { nodes: "nope" }, version: 1 }).success).toBe(false);
  });

  it("validates titles", () => {
    expect(renameCanvasBodySchema.safeParse({ title: "  Plan  " }).data?.title).toBe("Plan");
    expect(renameCanvasBodySchema.safeParse({ title: "   " }).success).toBe(false);
    expect(renameCanvasBodySchema.safeParse({ title: "x".repeat(201) }).success).toBe(false);
    expect(createCanvasBodySchema.safeParse({}).success).toBe(true);
  });
});

describe("copyTitle", () => {
  it("adds (copy) and counts up when taken", () => {
    expect(copyTitle("Plan")).toBe("Plan (copy)");
    expect(copyTitle("Plan", ["Plan (copy)"])).toBe("Plan (copy 2)");
    expect(copyTitle("Plan (copy)", ["Plan (copy)", "Plan (copy 2)"])).toBe("Plan (copy 3)");
  });
});

describe("row mapping", () => {
  const row = {
    id: "id",
    title: "T",
    version: 2,
    thumbnail: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
  };

  it("serialises dates as ISO strings", () => {
    expect(toSummary(row)).toEqual({ id: "id", title: "T", version: 2, thumbnail: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" });
  });

  it("repairs invalid stored data into an empty document", () => {
    expect(coerceData({ garbage: true }).nodes).toEqual([]);
    expect(toDetail({ ...row, data: emptyCanvas() }).data).toEqual(emptyCanvas());
  });
});
