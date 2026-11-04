import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Board, BoardDetailV2, Link, SyncStatus } from "../shared/types";
import { api, boardPath, message, request } from "./api";
const Canvas = lazy(() => import("./Canvas"));
import "./styles.css";

type Dialog = { kind: "create" } | { kind: "rename" | "delete"; board: Board };
export default function App() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [active, setActive] = useState<BoardDetailV2>();
  const [focus, setFocus] = useState<{ id: string; stamp: number }>();
  const navigationGuard = useRef<(() => Promise<void>) | undefined>(undefined);
  const [links, setLinks] = useState<Link[]>([]);
  const [status, setStatus] = useState<SyncStatus>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<Dialog>();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState("");
  const [revision, setRevision] = useState(0);
  const opening = useRef(0);
  const syncLock = useRef(false);
  const modalRef = useRef<HTMLDialogElement>(null);
  const refreshBoards = useCallback(() => {
    void api
      .boards()
      .then((result) => setBoards(result.items))
      .catch((e) => setError(message(e)));
  }, []);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [boards, links, status] = await Promise.all([
        api.boards(),
        api.links(),
        api.status(),
      ]);
      setBoards(boards.items);
      setLinks(links.items);
      setStatus(status);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (dialog) modalRef.current?.showModal();
    else modalRef.current?.close();
  }, [dialog]);
  useEffect(() => {
    const timer = setInterval(() => {
      void api
        .status()
        .then(setStatus)
        .catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, []);
  const openBoard = useCallback(async (id: string, focusId?: string) => {
    const generation = ++opening.current;
    setLoading(true);
    setError("");
    try {
      await navigationGuard.current?.();
      const board = await api.board(id);
      if (generation === opening.current) {
        setActive(board);
        setFocus(focusId ? { id: focusId, stamp: Date.now() } : undefined);
        history.replaceState(
          null,
          "",
          `#/board/${encodeURIComponent(id)}${focusId ? `?focus=${encodeURIComponent(focusId)}` : ""}`,
        );
        document.title = `${board.name} · CraftCanvas`;
      }
    } catch (e) {
      if (generation === opening.current) setError(message(e));
    } finally {
      if (generation === opening.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const route = () => {
      const match = location.hash.match(/^#\/board\/([^?]+)(?:\?(.*))?$/);
      if (!match) return;
      try {
        void openBoard(
          decodeURIComponent(match[1]),
          new URLSearchParams(match[2]).get("focus") || undefined,
        );
      } catch {
        setError("This board link is invalid.");
      }
    };
    route();
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, [openBoard]);
  const sync = async () => {
    if (syncLock.current) return;
    syncLock.current = true;
    setSyncing(true);
    setError("");
    setProgress("Connecting…");
    try {
      let cursor: string | undefined;
      let imported = 0;
      let skipped = 0;
      let partial = false;
      do {
        const result = await api.sync(cursor);
        imported += result.imported;
        skipped = result.skipped;
        partial ||= result.partial;
        setProgress(
          `${imported} notes imported${result.total === null ? "" : ` / ${result.total}`}`,
        );
        if (result.done) break;
        if (!result.cursor)
          throw new Error(
            "Sync returned no continuation cursor. Try syncing again.",
          );
        cursor = result.cursor;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } while (true);
      const [status, links] = await Promise.all([api.status(), api.links()]);
      setStatus(status);
      setLinks(links.items);
      setRevision((n) => n + 1);
      setProgress(
        `Sync complete${skipped ? ` · ${skipped} unavailable notes skipped` : ""}${partial ? " · Partial library; existing notes retained" : ""}`,
      );
    } catch (e) {
      setError(message(e));
      setProgress("Sync interrupted. Try again.");
    } finally {
      syncLock.current = false;
      setSyncing(false);
    }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!dialog || busy) return;
    setBusy(true);
    setError("");
    try {
      if (dialog.kind === "delete") {
        await request(boardPath(dialog.board.id), "DELETE");
      } else if (dialog.kind === "rename") {
        await request(boardPath(dialog.board.id), "PATCH", {
          name: name.trim(),
        });
      } else {
        const created = await request<Board>("/api/boards", "POST", {
          name: name.trim(),
        });
        await openBoard(created.id);
      }
      setDialog(undefined);
      refreshBoards();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-symbol" aria-hidden="true">
            ▧
          </span>
          <span>CraftCanvas</span>
          <span className="private-badge">PRIVATE</span>
        </div>
        <div className="sync-area">
          <span
            className="sync-status"
            title={
              status?.lastSyncAt
                ? `Last synced ${new Date(status.lastSyncAt).toLocaleString()}`
                : "Not synced yet"
            }
          >
            <i />
            {status
              ? `${status.noteCount} notes · ${status.linkCount} links`
              : "Checking library…"}
            <small>
              {status?.lastSyncAt
                ? `Synced ${new Date(status.lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : "Ready for your first sync"}
              {status?.mode === "fixture" ? " · Fixture library" : ""}
            </small>
          </span>
          <button
            disabled={syncing || status?.running}
            onClick={() => void sync()}
          >
            {syncing
              ? "↻ Syncing…"
              : status?.running
                ? "↻ Sync running"
                : "↻ Sync notes"}
          </button>
        </div>
      </header>
      {progress && (
        <div className="sync-progress" role="status">
          {progress}
        </div>
      )}
      {error && !dialog && (
        <div className="error app-error" role="alert">
          {error}
          <button onClick={() => void refresh()}>Retry</button>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {active ? (
        <Suspense
          fallback={
            <p className="muted" role="status">
              Opening canvas…
            </p>
          }
        >
          <Canvas
            key={active.id}
            initial={active}
            focus={focus}
            navigationGuard={navigationGuard}
            links={links}
            onBack={() => {
              setActive(undefined);
              setFocus(undefined);
              history.replaceState(
                null,
                "",
                location.pathname + location.search,
              );
              document.title = "CraftCanvas";
              refreshBoards();
            }}
            onOpenBoard={(id, focusId) => void openBoard(id, focusId)}
            revision={revision}
            onChanged={refreshBoards}
          />
        </Suspense>
      ) : (
        <main className="board-list">
          <div className="collection-heading">
            <div>
              <p className="eyebrow">A PLACE TO THINK</p>
              <h1>
                Your boards<span>.</span>
              </h1>
              <p className="intro">Make room for ideas to find each other.</p>
            </div>
            <button
              className="primary"
              onClick={() => {
                setName("");
                setDialog({ kind: "create" });
              }}
            >
              + New board
            </button>
          </div>
          <div className="collection-label">
            <span>
              ALL BOARDS <b>{boards.length.toString().padStart(2, "0")}</b>
            </span>
            <span>Notes from Craft. Connections made here.</span>
          </div>
          {loading && (
            <p role="status" className="muted">
              Opening your workspace…
            </p>
          )}
          {!loading && !boards.length && (
            <section className="library-empty">
              <div className="empty-art">
                ▤ <span>↗</span> ▤
              </div>
              <h2>A fresh page for your thinking.</h2>
              <p>
                Create a board, then add notes from search.
                <br />
                Arrange ideas freely. Your originals stay in Craft.
              </p>
              <button
                className="primary"
                onClick={() => {
                  setName("");
                  setDialog({ kind: "create" });
                }}
              >
                Create your first board
              </button>
            </section>
          )}
          <div className="board-grid">
            {boards.map((board, index) => (
              <article className="board-tile" key={board.id}>
                <button
                  className="board-open"
                  disabled={loading}
                  onClick={() => void openBoard(board.id)}
                  aria-label={`Open board ${board.name}`}
                >
                  <div className={`board-cover cover-${index % 3}`}>
                    <div className="mini-card mini-one">
                      <i />
                      <i />
                      <i />
                    </div>
                    <div className="mini-thread" />
                    <div className="mini-card mini-two">
                      <i />
                      <i />
                    </div>
                    <div className="mini-card mini-three">
                      <i />
                      <i />
                      <i />
                    </div>
                    <span className="cover-count">
                      {board.cardCount}{" "}
                      {board.cardCount === 1 ? "note" : "notes"}
                    </span>
                  </div>
                  <div className="board-info">
                    <h2>{board.name}</h2>
                    <p>
                      {board.cardCount
                        ? "An evolving collection of ideas"
                        : "Add notes from search to get started"}
                    </p>
                  </div>
                </button>
                <div className="board-meta">
                  <span>
                    Updated{" "}
                    {new Date(board.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <div>
                    <button
                      aria-label={`Rename board ${board.name}`}
                      onClick={() => {
                        setName(board.name);
                        setDialog({ kind: "rename", board });
                      }}
                    >
                      Rename
                    </button>
                    <button
                      aria-label={`Delete board ${board.name}`}
                      onClick={() => setDialog({ kind: "delete", board })}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
            {boards.length > 0 && (
              <button
                className="new-board-tile"
                onClick={() => {
                  setName("");
                  setDialog({ kind: "create" });
                }}
              >
                <span>＋</span>Start a new connection
                <small>Create a board</small>
              </button>
            )}
          </div>
          <footer className="library-footer">
            <span>▧ A quiet space for connected thinking.</span>
            <span>Read-only Craft library</span>
          </footer>
        </main>
      )}
      <dialog
        ref={modalRef}
        onCancel={() => {
          if (!busy) {
            setDialog(undefined);
            setError("");
          }
        }}
        aria-labelledby="dialog-title"
      >
        <form onSubmit={submit}>
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h2 id="dialog-title">
            {dialog?.kind === "delete"
              ? "Delete this board?"
              : dialog?.kind === "rename"
                ? "Rename board"
                : "A new place for ideas"}
          </h2>
          {dialog?.kind === "delete" ? (
            <p>
              “{dialog.board.name}” and its layout will be removed. Your notes
              remain in Craft and on other boards.
            </p>
          ) : (
            <label>
              Board name
              <input
                autoFocus
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Things I’m thinking about"
              />
            </label>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDialog(undefined);
                setError("");
              }}
            >
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || (dialog?.kind !== "delete" && !name.trim())}
            >
              {busy
                ? "Saving…"
                : dialog?.kind === "delete"
                  ? "Delete board"
                  : dialog?.kind === "rename"
                    ? "Save name"
                    : "Create board"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
