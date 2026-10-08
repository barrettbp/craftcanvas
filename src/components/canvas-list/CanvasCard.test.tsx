import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CanvasSummary } from "@/lib/canvas/types";

import { CanvasCard } from "./CanvasCard";

const base: CanvasSummary = {
  id: "c1",
  title: "Alpha plan",
  version: 1,
  thumbnail: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const noop = { onRename: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn() };

describe("<CanvasCard> thumbnail", () => {
  it("shows the placeholder when there is no thumbnail", () => {
    render(<CanvasCard canvas={base} {...noop} />);
    expect(screen.getByText("No preview yet")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders a data URL thumbnail", () => {
    const thumbnail = "data:image/png;base64,iVBORw0KGgo=";
    render(<CanvasCard canvas={{ ...base, thumbnail }} {...noop} />);
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", thumbnail);
    expect(screen.queryByText("No preview yet")).not.toBeInTheDocument();
  });

  it("renders a storage URL thumbnail and ignores anything else", () => {
    render(<CanvasCard canvas={{ ...base, thumbnail: "https://example.supabase.co/storage/v1/object/public/thumbnails/u/c1.png" }} {...noop} />);
    expect(document.querySelector("img")).toHaveAttribute("src", expect.stringContaining("/thumbnails/u/c1.png"));
  });

  it("does not render a non URL thumbnail value", () => {
    render(<CanvasCard canvas={{ ...base, thumbnail: "javascript:alert(1)" }} {...noop} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("No preview yet")).toBeInTheDocument();
  });
});
