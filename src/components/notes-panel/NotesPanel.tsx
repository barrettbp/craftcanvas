"use client";

/**
 * Notes panel: folder tree, search and drag source for Craft documents.
 *
 * Talks only to `/api/craft/*`. It deliberately does not import from
 * `src/store`; the canvas tells it which documents are already placed through
 * `docIdsOnCanvas` and receives new ones through `onAddDocument` or a drop of
 * the `application/x-craftcanvas-doc` payload.
 */
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, LoaderCircle, Plus, RefreshCw, Search, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CRAFT_DOC_DRAG_TYPE, type CraftDocDragPayload, type CraftFolder, type CraftStatusResponse, type SearchResponse } from "@/lib/craft/types";

import { ReconnectBanner } from "./ReconnectBanner";
import { formatRelativeTime } from "./relative-time";

export type NotesPanelDocument = { craftDocId: string; title: string; folderPath: string };

export type NotesPanelProps = {
  /** Craft document ids already placed on the current canvas (shown with a dot). */
  docIdsOnCanvas: Set<string>;
  /** Called when the plus icon of a row is clicked. The canvas drops the card at the viewport centre. */
  onAddDocument: (doc: NotesPanelDocument) => void;
  /** Lets the canvas focus the search box (Cmd/Ctrl K). */
  searchInputRef?: React.Ref<HTMLInputElement>;
};

type Row = { id: string; title: string; folderPath: string; updatedAt: string | null; missing?: boolean };

type DocumentsResponse = { location: string | null; source: "craft" | "local"; documents: Row[] };

type LocationState = { loading: boolean; rows: Row[]; error?: string };

const ROOT = "";
const SEARCH_DEBOUNCE_MS = 300;
const STATUS_POLL_MS = 2500;

type FetchOutcome<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function apiGet<T>(url: string, signal?: AbortSignal): Promise<FetchOutcome<T>> {
  try {
    const res = await fetch(url, { signal, cache: "no-store" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, status: res.status, error: body?.error ?? `http_${res.status}` };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return { ok: false, status: 0, error: "aborted" };
    return { ok: false, status: 0, error: "network" };
  }
}

export function NotesPanel({ docIdsOnCanvas, onAddDocument, searchInputRef }: NotesPanelProps) {
  const [status, setStatus] = useState<CraftStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  const [folders, setFolders] = useState<CraftFolder[] | null>(null);
  const [foldersError, setFoldersError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [locations, setLocations] = useState<Record<string, LocationState>>({});

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [treeVersion, setTreeVersion] = useState(0);

  const unauthorizedRef = useRef(false);
  const noteUnauthorized = useCallback((outcome: FetchOutcome<unknown>) => {
    if (!outcome.ok && outcome.status === 403 && outcome.error === "craft_unauthorized") {
      unauthorizedRef.current = true;
      setUnauthorized(true);
      return true;
    }
    return false;
  }, []);

  // --- Status --------------------------------------------------------------
  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    const outcome = await apiGet<CraftStatusResponse>("/api/craft/status", signal);
    if (!outcome.ok) {
      if (outcome.error !== "aborted") setStatusError(outcome.error);
      return null;
    }
    setStatusError(null);
    setStatus(outcome.data);
    const unauth = outcome.data.connected && outcome.data.status === "unauthorized";
    unauthorizedRef.current = unauth;
    setUnauthorized(unauth);
    return outcome.data;
  }, []);

  // --- Documents per location ---------------------------------------------
  const loadLocation = useCallback(
    async (location: string, signal?: AbortSignal) => {
      setLocations((prev) => ({ ...prev, [location]: { loading: true, rows: prev[location]?.rows ?? [] } }));
      const qs = location ? `?location=${encodeURIComponent(location)}` : "";
      const outcome = await apiGet<DocumentsResponse>(`/api/craft/documents${qs}`, signal);
      if (!outcome.ok) {
        if (outcome.error === "aborted") return;
        noteUnauthorized(outcome);
        setLocations((prev) => ({ ...prev, [location]: { loading: false, rows: prev[location]?.rows ?? [], error: outcome.error } }));
        return;
      }
      setLocations((prev) => ({ ...prev, [location]: { loading: false, rows: outcome.data.documents } }));
    },
    [noteUnauthorized],
  );

  // --- Initial load + stale refresh ----------------------------------------
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const current = await loadStatus(controller.signal);
      if (!current || !current.connected || current.status === "unauthorized") return;

      const [foldersOutcome] = await Promise.all([
        apiGet<{ folders: CraftFolder[] }>("/api/craft/folders", controller.signal),
        loadLocation(ROOT, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      if (foldersOutcome.ok) {
        setFolders(foldersOutcome.data.folders);
        setFoldersError(null);
      } else if (foldersOutcome.error !== "aborted") {
        noteUnauthorized(foldersOutcome);
        setFoldersError(foldersOutcome.error);
      }

      // Background refresh when the index is older than 15 minutes (no-op when fresh).
      try {
        const res = await fetch("/api/craft/refresh?ifStale=1", { method: "POST", signal: controller.signal });
        if (res.status === 202) setRefreshing(true);
      } catch {
        // best effort
      }
    })();
    return () => controller.abort();
  }, [loadStatus, loadLocation, noteUnauthorized, treeVersion]);

  // --- Poll status while a refresh runs ------------------------------------
  const expandedRef = useRef(expanded);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    if (!refreshing) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const current = await loadStatus();
      if (cancelled) return;
      if (current && !current.syncing) {
        setRefreshing(false);
        // Reload the tree (initial-load effect re-runs) and the folders that are open.
        setLocations({});
        setTreeVersion((v) => v + 1);
        for (const id of expandedRef.current) void loadLocation(id);
        return;
      }
      timer = setTimeout(tick, STATUS_POLL_MS);
    };
    timer = setTimeout(tick, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refreshing, loadStatus, loadLocation]);

  // --- Search ---------------------------------------------------------------
  const searchSeq = useRef(0);

  /** Single entry point for query changes so the effect below only performs fetches. */
  function updateQuery(value: string) {
    setQuery(value);
    if (value.trim().length === 0) {
      setResults(null);
      setSearching(false);
    } else {
      setSearching(true);
    }
  }

  useEffect(() => {
    const q = query.trim();
    if (q.length === 0) return;
    const seq = ++searchSeq.current;
    const controller = new AbortController();

    // Local hits straight away.
    void apiGet<SearchResponse>(`/api/craft/search?scope=local&q=${encodeURIComponent(q)}`, controller.signal).then((outcome) => {
      if (seq !== searchSeq.current) return;
      if (outcome.ok) setResults(outcome.data);
      else noteUnauthorized(outcome);
    });

    // Craft search merged after a pause.
    const timer = setTimeout(() => {
      void apiGet<SearchResponse>(`/api/craft/search?q=${encodeURIComponent(q)}`, controller.signal).then((outcome) => {
        if (seq !== searchSeq.current) return;
        if (outcome.ok) setResults(outcome.data);
        else noteUnauthorized(outcome);
        setSearching(false);
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, noteUnauthorized]);

  // --- Refresh button -------------------------------------------------------
  async function refreshNotes() {
    setRefreshNote(null);
    try {
      const res = await fetch("/api/craft/refresh", { method: "POST" });
      if (res.status === 202 || res.status === 200) {
        setRefreshing(true);
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string; retryAfter?: number } | null;
      if (res.status === 429) {
        setRefreshNote(`Already refreshed recently. Try again in ${body?.retryAfter ?? 60}s.`);
      } else if (res.status === 403 && body?.error === "craft_unauthorized") {
        setUnauthorized(true);
      } else {
        setRefreshNote("Refresh failed. Try again in a moment.");
      }
    } catch {
      setRefreshNote("Refresh failed. Check your connection.");
    }
  }

  // --- Tree helpers ---------------------------------------------------------
  const childrenByParent = useMemo(() => {
    const map = new Map<string, CraftFolder[]>();
    for (const f of folders ?? []) {
      const key = f.parentId ?? ROOT;
      const list = map.get(key) ?? [];
      list.push(f);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [folders]);

  function toggleFolder(id: string) {
    const opening = !expanded.has(id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Lazy load documents the first time a folder opens.
    if (opening && !locations[id]) void loadLocation(id);
  }

  // --- Render ---------------------------------------------------------------
  const notConnected = status !== null && !status.connected;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-sm text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="border-b border-zinc-200 p-2 dark:border-zinc-800">
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(e) => updateQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") updateQuery("");
            }}
            placeholder="Search notes"
            aria-label="Search notes"
            disabled={notConnected}
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 py-1.5 pr-7 pl-8 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-500"
          />
          {query ? (
            <button
              type="button"
              onClick={() => updateQuery("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </label>
      </div>

      {unauthorized ? (
        <div className="p-2">
          <ReconnectBanner compact />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {statusError && !status ? (
          <PanelMessage>Could not load your Craft status. {statusError === "unauthenticated" ? "Sign in again." : "Try again shortly."}</PanelMessage>
        ) : status === null ? (
          <Loading label="Loading notes…" />
        ) : notConnected ? (
          <PanelMessage>
            <p className="font-medium text-zinc-700 dark:text-zinc-200">No Craft space connected</p>
            <p className="mt-1">Connect Craft to browse your notes and drop them onto the canvas.</p>
            <Link
              href="/settings/craft"
              className="mt-3 inline-block rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Connect Craft
            </Link>
          </PanelMessage>
        ) : query.trim().length > 0 ? (
          <SearchResults results={results} searching={searching} docIdsOnCanvas={docIdsOnCanvas} onAddDocument={onAddDocument} />
        ) : unauthorized ? null : folders === null && !foldersError ? (
          <Loading label="Loading folders…" />
        ) : (
          <ul className="py-1" role="tree" aria-label="Folders">
            {foldersError ? (
              <li className="px-3 py-2 text-xs text-amber-700 dark:text-amber-300">Could not load folders ({foldersError}).</li>
            ) : null}
            {(childrenByParent.get(ROOT) ?? []).map((folder) => (
              <FolderNode
                key={folder.id}
                folder={folder}
                depth={0}
                expanded={expanded}
                childrenByParent={childrenByParent}
                locations={locations}
                onToggle={toggleFolder}
                docIdsOnCanvas={docIdsOnCanvas}
                onAddDocument={onAddDocument}
              />
            ))}
            {(locations[ROOT]?.rows.length ?? 0) > 0 ? (
              <li role="treeitem" aria-expanded="true" aria-selected={false}>
                {(folders?.length ?? 0) > 0 ? (
                  <div className="px-3 pt-3 pb-1 text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">Other documents</div>
                ) : null}
                <DocList rows={locations[ROOT].rows} depth={0} docIdsOnCanvas={docIdsOnCanvas} onAddDocument={onAddDocument} />
              </li>
            ) : null}
            {folders && folders.length === 0 && (locations[ROOT]?.rows.length ?? 0) === 0 && !locations[ROOT]?.loading ? (
              <li className="px-3 py-6 text-center text-xs text-zinc-500">
                No documents are visible through this connection.
                <br />
                <Link href="/settings/craft" className="underline">
                  Check the connection scope
                </Link>
              </li>
            ) : null}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-zinc-200 px-2 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <span className="truncate" title={status?.lastFullSync ?? undefined}>
          {refreshing || status?.syncing ? "Syncing…" : status?.connected ? `Synced ${formatRelativeTime(status.lastFullSync)}` : ""}
          {refreshNote ? ` · ${refreshNote}` : ""}
        </span>
        <button
          type="button"
          onClick={() => void refreshNotes()}
          disabled={!status?.connected || refreshing || Boolean(status?.syncing)}
          className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing || status?.syncing ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh notes
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PanelMessage({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 text-center text-xs text-zinc-500 dark:text-zinc-400">{children}</div>;
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-zinc-500">
      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

type FolderNodeProps = {
  folder: CraftFolder;
  depth: number;
  expanded: Set<string>;
  childrenByParent: Map<string, CraftFolder[]>;
  locations: Record<string, LocationState>;
  onToggle: (id: string) => void;
  docIdsOnCanvas: Set<string>;
  onAddDocument: (doc: NotesPanelDocument) => void;
};

function FolderNode({ folder, depth, expanded, childrenByParent, locations, onToggle, docIdsOnCanvas, onAddDocument }: FolderNodeProps) {
  const isOpen = expanded.has(folder.id);
  const children = childrenByParent.get(folder.id) ?? [];
  const state = locations[folder.id];
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  const Icon = isOpen ? FolderOpen : Folder;

  return (
    <li role="treeitem" aria-expanded={isOpen} aria-selected={false}>
      <button
        type="button"
        onClick={() => onToggle(folder.id)}
        className="flex w-full items-center gap-1.5 py-1 pr-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <Chevron className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
        <Icon className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
        <span className="truncate">{folder.name}</span>
      </button>
      {isOpen ? (
        <ul role="group">
          {children.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              expanded={expanded}
              childrenByParent={childrenByParent}
              locations={locations}
              onToggle={onToggle}
              docIdsOnCanvas={docIdsOnCanvas}
              onAddDocument={onAddDocument}
            />
          ))}
          {!state || state.loading ? (
            <li className="py-1 text-xs text-zinc-400" style={{ paddingLeft: 8 + (depth + 1) * 14 + 20 }}>
              Loading…
            </li>
          ) : state.error ? (
            <li className="py-1 text-xs text-amber-700 dark:text-amber-300" style={{ paddingLeft: 8 + (depth + 1) * 14 + 20 }}>
              Could not load documents.
            </li>
          ) : state.rows.length === 0 && children.length === 0 ? (
            <li className="py-1 text-xs text-zinc-400" style={{ paddingLeft: 8 + (depth + 1) * 14 + 20 }}>
              Empty folder
            </li>
          ) : (
            <DocList rows={state.rows} depth={depth + 1} docIdsOnCanvas={docIdsOnCanvas} onAddDocument={onAddDocument} />
          )}
        </ul>
      ) : null}
    </li>
  );
}

function DocList({
  rows,
  depth,
  docIdsOnCanvas,
  onAddDocument,
}: {
  rows: Row[];
  depth: number;
  docIdsOnCanvas: Set<string>;
  onAddDocument: (doc: NotesPanelDocument) => void;
}) {
  return (
    <>
      {rows.map((row) => (
        <DocRow key={row.id} row={row} depth={depth} onCanvas={docIdsOnCanvas.has(row.id)} onAddDocument={onAddDocument} showPath={false} />
      ))}
    </>
  );
}

function DocRow({
  row,
  depth,
  onCanvas,
  onAddDocument,
  showPath,
}: {
  row: Row;
  depth: number;
  onCanvas: boolean;
  onAddDocument: (doc: NotesPanelDocument) => void;
  showPath: boolean;
}) {
  const payload: CraftDocDragPayload = { craftDocId: row.id, title: row.title, folderPath: row.folderPath };

  return (
    <li
      role="treeitem"
      aria-selected={false}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CRAFT_DOC_DRAG_TYPE, JSON.stringify(payload));
        e.dataTransfer.setData("text/plain", row.title);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={`group flex cursor-grab items-center gap-1.5 py-1 pr-1 hover:bg-zinc-100 active:cursor-grabbing dark:hover:bg-zinc-900 ${row.missing ? "opacity-60" : ""}`}
      style={{ paddingLeft: 8 + depth * 14 + 20 }}
      title={row.folderPath ? `${row.folderPath} / ${row.title}` : row.title}
    >
      <FileText className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate">{row.title}</span>
          {onCanvas ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" title="Already on this canvas" aria-label="On canvas" /> : null}
          {row.missing ? <span className="shrink-0 text-[10px] text-zinc-400">missing</span> : null}
        </div>
        <div className="truncate text-[11px] text-zinc-400">
          {showPath && row.folderPath ? `${row.folderPath} · ` : ""}
          {row.updatedAt ? formatRelativeTime(row.updatedAt) : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAddDocument(payload);
        }}
        aria-label={`Add ${row.title} to canvas`}
        title="Add to canvas"
        className="shrink-0 rounded p-1 text-zinc-400 opacity-0 group-hover:opacity-100 hover:bg-zinc-200 hover:text-zinc-900 focus:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

function SearchResults({
  results,
  searching,
  docIdsOnCanvas,
  onAddDocument,
}: {
  results: SearchResponse | null;
  searching: boolean;
  docIdsOnCanvas: Set<string>;
  onAddDocument: (doc: NotesPanelDocument) => void;
}) {
  if (!results) return <Loading label="Searching…" />;
  if (results.documents.length === 0 && !searching) {
    return (
      <PanelMessage>
        No notes match &ldquo;{results.query}&rdquo;.
        {results.craftError ? <p className="mt-1">Craft search was unavailable; only the local index was searched.</p> : null}
      </PanelMessage>
    );
  }
  return (
    <div>
      <ul role="tree" aria-label="Search results" className="py-1">
        {results.documents.map((doc) => (
          <DocRow
            key={doc.id}
            row={{ id: doc.id, title: doc.title, folderPath: doc.folderPath, updatedAt: doc.updatedAt, missing: doc.missing }}
            depth={0}
            onCanvas={docIdsOnCanvas.has(doc.id)}
            onAddDocument={onAddDocument}
            showPath
          />
        ))}
      </ul>
      <div className="px-3 py-1 text-[11px] text-zinc-400">
        {searching ? "Searching Craft…" : results.craftError ? "Craft search unavailable, showing local results." : `${results.documents.length} result${results.documents.length === 1 ? "" : "s"}`}
      </div>
    </div>
  );
}

export default NotesPanel;
