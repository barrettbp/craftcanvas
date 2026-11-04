import { useEffect, useState } from "react";
import type { NoteSummary } from "../shared/types";
import { api, message } from "./api";

export default function SearchPanel({
  onClose,
  onAdd,
  added,
  revision,
}: {
  onClose: () => void;
  onAdd: (note: NoteSummary) => Promise<void>;
  added: Set<string>;
  revision: number;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<NoteSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(
      () =>
        api
          .notes(query, offset, controller.signal)
          .then((result) => {
            setItems(result.items);
            setTotal(result.total);
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
  }, [query, offset, revision, retry]);
  return (
    <aside className="search-panel" aria-label="Search notes">
      <div className="reader-toolbar">
        <h2>Add from your library</h2>
        <button aria-label="Close search" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="muted">Your notes stay in Craft. Arrange them here.</p>
      <label className="search-input">
        <span>⌕</span>
        <input
          autoFocus
          aria-label="Search notes"
          placeholder="Search titles and previews…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      <div className="search-count" role="status">
        {loading ? "Searching…" : `${total} notes in your library`}
      </div>
      {error && (
        <p className="error" role="alert">
          {error} <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
        </p>
      )}
      {!loading && !items.length && !error && (
        <div className="small-empty">
          {query
            ? "No matching notes. Try another phrase."
            : "Your library is empty. Sync notes to get started."}
        </div>
      )}
      {!loading &&
        items.map((note) => (
          <div className="search-result" key={note.id}>
            <div className="folder">{note.folderName || "Unfiled"}</div>
            <h3>{note.title}</h3>
            <p>{note.preview}</p>
            <button
              disabled={pending !== undefined || added.has(note.id)}
              onClick={async () => {
                setPending(note.id);
                setError("");
                try {
                  await onAdd(note);
                } catch (e) {
                  setError(message(e));
                } finally {
                  setPending(undefined);
                }
              }}
            >
              {added.has(note.id)
                ? "✓ On this board"
                : pending === note.id
                  ? "Adding…"
                  : "+ Add to board"}
            </button>
          </div>
        ))}
      {total > 50 && (
        <div className="pagination">
          <button
            disabled={!offset || loading}
            onClick={() => setOffset((n) => n - 50)}
          >
            Previous
          </button>
          <span>
            {offset + 1}–{Math.min(offset + 50, total)}
          </span>
          <button
            disabled={offset + 50 >= total || loading}
            onClick={() => setOffset((n) => n + 50)}
          >
            Next
          </button>
        </div>
      )}
    </aside>
  );
}
