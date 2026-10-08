import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CanvasSummary } from "@/lib/canvas/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { CanvasList, filterByTitle, sortByUpdated } from "./CanvasList";

const items: CanvasSummary[] = [
  { id: "1", title: "Alpha plan", version: 1, thumbnail: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
  { id: "2", title: "Beta research", version: 1, thumbnail: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z" },
];

describe("canvas list helpers", () => {
  it("sorts by updated time, newest first", () => {
    expect(sortByUpdated(items).map((c) => c.id)).toEqual(["2", "1"]);
  });
  it("filters by title, case insensitive", () => {
    expect(filterByTitle(items, "BETA").map((c) => c.id)).toEqual(["2"]);
    expect(filterByTitle(items, "  ")).toHaveLength(2);
  });
});

describe("<CanvasList>", () => {
  it("renders the empty state and the Craft note", () => {
    render(<CanvasList initial={[]} hasCraftConnection={false} />);
    expect(screen.getByText("No canvases yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /connect Craft in settings/i })).toHaveAttribute("href", "/settings/craft");
  });

  it("renders cards newest first without the Craft note when connected", () => {
    render(<CanvasList initial={items} hasCraftConnection />);
    const links = screen.getAllByRole("link", { name: /^Open / });
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual(["Open Beta research", "Open Alpha plan"]);
    expect(screen.queryByText(/connect Craft in settings/i)).not.toBeInTheDocument();
  });
});
