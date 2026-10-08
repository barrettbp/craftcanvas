"use client";

/**
 * Canvas list (spec 8.7): grid of cards with thumbnail, title and relative
 * updated time; new canvas, inline rename, duplicate, delete with confirm,
 * sorted by last updated, client side search by title, empty states.
 */
import { LayoutGrid, Plus, Search, SearchX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import { createCanvas, deleteCanvas, duplicateCanvas, renameCanvas } from "@/lib/canvas/client";
import type { CanvasSummary } from "@/lib/canvas/types";

import { CanvasCard } from "./CanvasCard";

export function sortByUpdated(items: CanvasSummary[]): CanvasSummary[] {
  return [...items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function filterByTitle(items: CanvasSummary[], query: string): CanvasSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((c) => c.title.toLowerCase().includes(q));
}

export function CanvasList({ initial, hasCraftConnection }: { initial: CanvasSummary[]; hasCraftConnection: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<CanvasSummary[]>(initial);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => filterByTitle(sortByUpdated(items), query), [items, query]);

  const withError = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const onNew = () =>
    withError(async () => {
      setCreating(true);
      try {
        const created = await createCanvas();
        router.push(`/canvas/${created.id}`);
      } finally {
        setCreating(false);
      }
    });

  const onRename = (id: string, title: string) =>
    withError(async () => {
      const previous = items;
      setItems((list) => list.map((c) => (c.id === id ? { ...c, title } : c)));
      try {
        const updated = await renameCanvas(id, title);
        setItems((list) => list.map((c) => (c.id === id ? updated : c)));
      } catch (err) {
        setItems(previous);
        throw err;
      }
    });

  const onDuplicate = (id: string) =>
    withError(async () => {
      const copy = await duplicateCanvas(id);
      setItems((list) => [copy, ...list]);
    });

  const onDelete = (id: string) =>
    withError(async () => {
      const previous = items;
      setItems((list) => list.filter((c) => c.id !== id));
      try {
        await deleteCanvas(id);
      } catch (err) {
        setItems(previous);
        throw err;
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Canvases</h1>
        <div className="ml-auto flex items-center gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title"
              aria-label="Search canvases by title"
              className="h-9 w-56 rounded-md border border-zinc-200 bg-white pl-8 pr-3 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <button
            type="button"
            onClick={() => void onNew()}
            disabled={creating}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New canvas
          </button>
        </div>
      </div>

      {!hasCraftConnection ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Craft is not connected yet. Text cards, groups and arrows work right away. To drag your notes onto a canvas,{" "}
          <Link href="/settings/craft" className="font-medium underline">
            connect Craft in settings
          </Link>{" "}
          (it takes about a minute).
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          outlined
          icon={<LayoutGrid aria-hidden />}
          title="No canvases yet"
          description="A canvas is a board for your Craft notes: drop documents on it, connect them with arrows and add text cards and groups."
          action={
            <button
              type="button"
              onClick={() => void onNew()}
              disabled={creating}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Create your first canvas
            </button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<SearchX aria-hidden />}
          title={`No canvases match “${query.trim()}”`}
          description="Titles are searched. Clear the search to see every canvas."
          action={
            <button type="button" onClick={() => setQuery("")} className="text-xs font-medium underline underline-offset-2">
              Clear search
            </button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((canvas) => (
            <li key={canvas.id}>
              <CanvasCard
                canvas={canvas}
                onRename={(title) => void onRename(canvas.id, title)}
                onDuplicate={() => void onDuplicate(canvas.id)}
                onDelete={() => void onDelete(canvas.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
