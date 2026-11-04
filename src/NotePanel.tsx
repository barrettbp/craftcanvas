import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import type { Note } from "../shared/types";
import { api, message } from "./api";

export default function NotePanel({
  id,
  revision,
  onClose,
  onNote,
  onBoard,
}: {
  id: string;
  revision: number;
  onClose: () => void;
  onNote: (id: string) => void;
  onBoard: (id: string) => void;
}) {
  const [note, setNote] = useState<Note>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setNote(undefined);
    setError("");
    api
      .note(id, controller.signal)
      .then(setNote)
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [id, retry, revision]);
  // Note bodies are untrusted: no remote images, raw HTML, embeds, or external navigation.
  const internalLink = (href?: string) => {
    if (!href?.startsWith("block://")) return undefined;
    const blockId = href.slice(8).split(/[?#]/)[0];
    return (
      note?.outgoing.find((link) => link.targetBlockId === blockId)
        ?.targetNoteId || undefined
    );
  };
  const appLink =
    note && /^(craftdocs:|https?:)/i.test(note.deepLinkApp)
      ? note.deepLinkApp
      : undefined;
  const webLink =
    note && /^https?:/i.test(note.deepLinkWeb) ? note.deepLinkWeb : undefined;
  return (
    <aside className="reader" aria-label="Note reader">
      <div className="reader-toolbar">
        <span className="eyebrow">FROM YOUR LIBRARY · READ ONLY</span>
        <button aria-label="Close note" onClick={onClose}>
          ×
        </button>
      </div>
      {error && (
        <div role="alert" className="error">
          {error} <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
        </div>
      )}
      {!note && !error && <p className="muted">Opening note…</p>}
      {note && (
        <>
          <div className="folder">{note.folderName || "Unfiled"}</div>
          <h2>{note.title}</h2>
          <div className="deep-links">
            {appLink && (
              <a className="button primary" href={appLink} rel="noreferrer">
                Open in Craft ↗
              </a>
            )}
            {webLink && (
              <a href={webLink} target="_blank" rel="noreferrer">
                Open web version ↗
              </a>
            )}
          </div>
          <article className="markdown">
            <Markdown
              skipHtml
              urlTransform={(url) => (url.startsWith("block://") ? url : "")}
              components={{
                img: ({ alt }) => (
                  <span className="image-placeholder">
                    Image{alt ? `: ${alt}` : ""} · view in Craft
                  </span>
                ),
                a: ({ href, children }) => {
                  const target = internalLink(href);
                  return target ? (
                    <button
                      className="inline-link"
                      onClick={() => onNote(target)}
                    >
                      {children}
                    </button>
                  ) : (
                    <span title="Open this link in Craft">{children}</span>
                  );
                },
              }}
            >
              {note.markdown}
            </Markdown>
          </article>
          <section className="note-relations">
            <h3>
              Outgoing links <span>{note.outgoing.length}</span>
            </h3>
            {note.outgoing.length === 0 && (
              <p className="muted">No outgoing links.</p>
            )}
            {note.outgoing.map((link, i) => (
              <button
                key={`${link.targetBlockId}-${i}`}
                disabled={!link.targetNoteId || link.outOfScope}
                onClick={() => link.targetNoteId && onNote(link.targetNoteId)}
              >
                {link.label || "Linked note"}{" "}
                <span>
                  {link.outOfScope || !link.targetNoteId
                    ? "Outside cache"
                    : "↗"}
                </span>
              </button>
            ))}
          </section>
          <section className="note-relations">
            <h3>
              Incoming links <span>{note.incoming.length}</span>
            </h3>
            {note.incoming.length === 0 && (
              <p className="muted">No incoming links.</p>
            )}
            {note.incoming.map((link, i) => (
              <button
                key={`${link.sourceNoteId}-${i}`}
                onClick={() => onNote(link.sourceNoteId)}
              >
                {link.label || "Linked note"} <span>↙</span>
              </button>
            ))}
          </section>
          <section className="note-relations">
            <h3>
              On these boards <span>{note.boards.length}</span>
            </h3>
            {!note.boards.length && (
              <p className="muted">Not on a board yet.</p>
            )}
            {note.boards.map((board) => (
              <button
                key={board.boardId}
                onClick={() => onBoard(board.boardId)}
              >
                {board.boardName}
                <span>↗</span>
              </button>
            ))}
          </section>
        </>
      )}
    </aside>
  );
}
