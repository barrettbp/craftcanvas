import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CRAFT_DOC_DRAG_TYPE, type CraftStatusResponse } from "@/lib/craft/types";

import { NotesPanel } from "./NotesPanel";

type Route = (url: URL, init?: RequestInit) => unknown | Response;

function mockFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    const route = routes[url.pathname];
    if (!route) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    const result = route(url, init);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

const connected: CraftStatusResponse = {
  connected: true,
  status: "ok",
  lastFullSync: new Date(Date.now() - 2 * 60_000).toISOString(),
  label: "Craft space",
  host: "connect.craft.do",
  documentCount: 3,
  syncing: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NotesPanel", () => {
  it("shows the connect link when no space is connected", async () => {
    mockFetch({
      "/api/craft/status": () => ({ ...connected, connected: false, status: null, documentCount: 0, lastFullSync: null }),
    });
    render(<NotesPanel docIdsOnCanvas={new Set()} onAddDocument={() => {}} />);
    const link = await screen.findByRole("link", { name: "Connect Craft" });
    expect(link).toHaveAttribute("href", "/settings/craft");
  });

  it("renders the reconnect banner when the connection is unauthorized", async () => {
    mockFetch({ "/api/craft/status": () => ({ ...connected, status: "unauthorized" }) });
    render(<NotesPanel docIdsOnCanvas={new Set()} onAddDocument={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/stopped working/i);
    expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute("href", "/settings/craft");
  });

  it("loads folders, lazily loads documents, sets the drag payload and calls onAddDocument", async () => {
    const onAdd = vi.fn();
    const { calls } = mockFetch({
      "/api/craft/status": () => connected,
      "/api/craft/refresh": () => ({ started: false, alreadyRunning: false, reason: "fresh" }),
      "/api/craft/folders": () => ({
        folders: [
          { id: "f1", name: "Projects", path: "Projects" },
          { id: "f2", name: "Research", parentId: "f1", path: "Projects/Research" },
        ],
      }),
      "/api/craft/documents": (url) => {
        const location = url.searchParams.get("location");
        if (location === "f1") {
          return {
            location,
            source: "craft",
            documents: [
              { id: "d1", title: "Roadmap", folderId: "f1", folderPath: "Projects", updatedAt: new Date().toISOString(), missing: false },
              { id: "d2", title: "Budget", folderId: "f1", folderPath: "Projects", updatedAt: null, missing: false },
            ],
          };
        }
        return { location, source: "craft", documents: [] };
      },
    });

    render(<NotesPanel docIdsOnCanvas={new Set(["d2"])} onAddDocument={onAdd} />);

    const projects = await screen.findByRole("button", { name: "Projects" });
    expect(calls).toContain("POST /api/craft/refresh?ifStale=1");
    expect(calls.filter((c) => c.startsWith("GET /api/craft/documents?location=f1"))).toHaveLength(0);

    fireEvent.click(projects);
    const row = await screen.findByText("Roadmap");
    expect(calls.filter((c) => c === "GET /api/craft/documents?location=f1")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Research" })).toBeInTheDocument();
    expect(screen.getByLabelText("On canvas")).toBeInTheDocument();

    // Drag payload
    const li = row.closest("li")!;
    const store = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => store.set(type, value),
      effectAllowed: "none",
    };
    fireEvent.dragStart(li, { dataTransfer });
    expect(JSON.parse(store.get(CRAFT_DOC_DRAG_TYPE)!)).toEqual({ craftDocId: "d1", title: "Roadmap", folderPath: "Projects" });
    expect(dataTransfer.effectAllowed).toBe("copy");

    // Plus icon
    fireEvent.click(screen.getByRole("button", { name: "Add Roadmap to canvas" }));
    expect(onAdd).toHaveBeenCalledWith({ craftDocId: "d1", title: "Roadmap", folderPath: "Projects" });

    // Refresh button shows last synced time
    expect(screen.getByText(/Synced 2 min ago/)).toBeInTheDocument();
  });

  it("searches locally at once and merges Craft results after a pause", async () => {
    {
      const { calls } = mockFetch({
        "/api/craft/status": () => connected,
        "/api/craft/refresh": () => ({ started: false, alreadyRunning: false, reason: "fresh" }),
        "/api/craft/folders": () => ({ folders: [] }),
        "/api/craft/documents": () => ({ location: null, source: "craft", documents: [] }),
        "/api/craft/search": (url) => {
          const local = { id: "l1", title: "Local hit", folderPath: "A", updatedAt: null, source: "local" };
          if (url.searchParams.get("scope") === "local") return { query: "hit", documents: [local], counts: { local: 1, craft: 0 } };
          return {
            query: "hit",
            documents: [local, { id: "c1", title: "Craft hit", folderPath: "B", updatedAt: null, source: "craft" }],
            counts: { local: 1, craft: 1 },
          };
        },
      });

      render(<NotesPanel docIdsOnCanvas={new Set()} onAddDocument={() => {}} />);
      // Wait for the status call to resolve so the panel is in its connected state.
      await screen.findByText(/Synced/);

      const input = screen.getByLabelText("Search notes");
      fireEvent.change(input, { target: { value: "hit" } });

      // Local results arrive without waiting for the debounce.
      await screen.findByText("Local hit");
      expect(screen.queryByText("Craft hit")).not.toBeInTheDocument();
      expect(calls.filter((c) => c.includes("/api/craft/search?scope=local"))).toHaveLength(1);
      expect(calls.filter((c) => c.includes("/api/craft/search?q="))).toHaveLength(0);

      // Craft results are merged in after the 300ms pause.
      await screen.findByText("Craft hit", {}, { timeout: 2000 });
      expect(calls.filter((c) => c.includes("/api/craft/search?q=hit"))).toHaveLength(1);
      expect(screen.getByText("Local hit")).toBeInTheDocument();
    }
  });
});
