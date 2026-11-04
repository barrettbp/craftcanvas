import { useEffect, useState } from "react";
import type { NoteSummary } from "../shared/types";
import type { SearchResult } from "./phase2-contract";
import { api, message } from "./api";
import { objectApi } from "./objects-api";
// Split only exact <mark> tokens. Every other character is escaped by React.
export function SearchSnippet({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(<mark>[\s\S]*?<\/mark>)/g)
        .map((part, index) =>
          part.startsWith("<mark>") && part.endsWith("</mark>") ? (
            <mark key={index}>{part.slice(6, -7)}</mark>
          ) : (
            <span key={index}>{part}</span>
          ),
        )}
    </>
  );
}
export default function SearchPanel({
  onClose,
  onAdd,
  added,
  revision,
  onResult,
}: {
  onClose: () => void;
  onAdd: (note: NoteSummary) => Promise<void>;
  added: Set<string>;
  revision: number;
  onResult: (result: SearchResult) => void;
}) {
  const [query, setQuery] = useState(""),
    [items, setItems] = useState<SearchResult[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [pending, setPending] = useState<string>(),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(
      () =>
        objectApi
          .search(query, controller.signal)
          .then((result) => {
            setItems(result.results);
            setLoading(false);
          })
          .catch((e) => {
            if (!controller.signal.aborted) {
              setError(message(e));
              setLoading(false);
            }
          }),
      200,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, revision, retry]);
  return (
    <aside className="search-panel" aria-label="Search library">
      <div className="reader-toolbar">
        <h2>Search your workspace</h2>
        <button aria-label="Close search" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="muted">Craft notes, canvas ideas, and PDF pages.</p>
      <label className="search-input">
        <span>⌕</span>
        <input
          autoFocus
          aria-label="Search notes"
          placeholder="Search notes, objects, and PDFs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="search-count" role="status">
        {loading
          ? "Searching…"
          : `${items.length} results${items.length === 50 ? " · refine your search to see more" : ""}`}
      </div>
      {error && (
        <p role="alert" className="error">
          {error} <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
        </p>
      )}
      {!loading && !items.length && !error && (
        <p className="small-empty">
          {query
            ? "No matches. Try another phrase."
            : "Type a phrase to search your workspace."}
        </p>
      )}
      {!loading &&
        items.map((result) => {
          const noteId = result.id.startsWith("note:")
            ? result.id.slice(5)
            : result.id;
          return (
            <div className="search-result" key={result.id}>
              <div className="folder">
                {result.kind === "note"
                  ? "CRAFT NOTE"
                  : result.kind === "pdf_page"
                    ? `PDF · PAGE ${result.page}`
                    : (result.objectKind || "CANVAS OBJECT").toUpperCase()}
              </div>
              <h3>{result.title}</h3>
              <p>
                <SearchSnippet text={result.snippet} />
              </p>
              {result.kind === "note" ? (
                <button
                  disabled={!!pending || added.has(noteId)}
                  onClick={async () => {
                    setPending(result.id);
                    setError("");
                    try {
                      await onAdd(await api.note(noteId));
                    } catch (e) {
                      setError(message(e));
                    } finally {
                      setPending(undefined);
                    }
                  }}
                >
                  {added.has(noteId)
                    ? "✓ On this board"
                    : pending === result.id
                      ? "Adding…"
                      : "+ Add to board"}
                </button>
              ) : (
                <button onClick={() => onResult(result)}>
                  {result.kind === "pdf_page"
                    ? `Open page ${result.page}`
                    : "Go to object"}{" "}
                  ↗
                </button>
              )}
            </div>
          );
        })}
    </aside>
  );
}
