# CraftCanvas API contract (v1)

Owner: Claude (backend). Consumer: Codex (frontend). Change requests go through the SnapWork room.

Base: same origin, prefix `/api`. All responses are JSON. All endpoints except `POST /api/auth/login` require the session cookie (`cc_session`, HttpOnly, set by login). Unauthenticated API calls return `401 {"error":"unauthorized"}`. Unauthenticated page requests (any non-`/api` path) receive the login page instead of the SPA.

Errors: `{"error": "<code>", "message": "<human text>"}` with 400/401/404/409/429/500.

IDs are strings. Timestamps are ISO-8601 strings. Coordinates are numbers in canvas units.

## Auth
- `POST /api/auth/login` body `{"password": string}` → `200 {"ok": true}` and sets cookie; `401` on wrong password. Rate limited: 5 tries per minute per IP.
- `POST /api/auth/logout` → `200 {"ok": true}`, clears cookie.
- `GET /api/auth/me` → `200 {"ok": true, "mode": "fixture" | "craft"}`.

## Notes (read-only cache of Craft)
- `GET /api/notes?q=&folder=&limit=50&offset=0` → `{"items": NoteSummary[], "total": number}`. `q` is a case-insensitive match on title and preview.
- `GET /api/notes/:id` → `Note` (full markdown, outgoing and incoming links, boards that hold it).
- `GET /api/notes/:id/boards` → `{"items": [{"boardId","boardName","cardId","x","y"}]}`.
- `GET /api/links` → `{"items": Link[]}` for every resolved note-to-note link (both ends in the cache). Used to draw arrows.
- `GET /api/notes/:id/raw?format=markdown|json` → the raw Craft response for one document (debugging; `404` in fixture mode).
- `GET /api/folders` → `{"items": [{"id","name","noteCount"}]}`.

```ts
type NoteSummary = {
  id: string; title: string; folderId: string | null; folderName: string | null;
  preview: string; createdAt: string | null; modifiedAt: string | null;
  deepLinkApp: string; deepLinkWeb: string; linkCount: number; backlinkCount: number;
}
type Note = NoteSummary & {
  markdown: string;
  outgoing: Link[]; incoming: Link[];
  boards: { boardId: string; boardName: string; cardId: string }[];
}
type Link = {
  sourceNoteId: string; targetNoteId: string | null; targetBlockId: string;
  label: string; outOfScope: boolean;
}
```

## Sync (Craft → cache)
- `POST /api/sync` body `{"cursor"?: string}` → `{"done": boolean, "cursor": string | null, "imported": number, "total": number | null, "mode": "fixture"|"craft", "skipped": number, "partial": boolean}`. Call again with exactly the returned cursor until `done` (any other cursor → `400 bad_cursor`; start over with `cursor: null`). The frontend should wait ≥ 1 s between calls. `skipped` counts documents Craft refused (403/404/410); `partial` means a folder could not be listed, so nothing was marked deleted.
- `GET /api/sync/status` → `{"lastSyncAt": string | null, "noteCount": number, "linkCount": number, "mode": string, "running": boolean}`.

## Boards and layout (the tool's own storage)
- `GET /api/boards` → `{"items": Board[]}`.
- `POST /api/boards` body `{"name": string}` → `201 Board`.
- `GET /api/boards/:id` → `BoardDetail` (board + cards + sections + connections + the `NoteSummary` of every card's note).
- `PATCH /api/boards/:id` body `{"name"?: string, "viewport"?: {"x","y","zoom"}}` → `Board`.
- `DELETE /api/boards/:id` → `204`.
- `POST /api/boards/:id/cards` body `{"noteId": string, "x": number, "y": number, "w"?: number, "h"?: number, "color"?: string}` → `201 Card`. `409` if the note is already on the board.
- `PUT /api/boards/:id/cards` body `{"cards": Partial<Card> & {"id": string}[]}` → `{"updated": number}`. Bulk position/size/fold/section/color update after a drag; send only changed cards, debounce ~300 ms.
- `DELETE /api/boards/:id/cards/:cardId` → `204`.
- `POST /api/boards/:id/sections` body `{"name","x","y","w","h","color"?}` → `201 Section`.
- `PATCH /api/boards/:id/sections/:sectionId` body partial Section → `Section`.
- `DELETE /api/boards/:id/sections/:sectionId` → `204` (cards inside keep their position, `sectionId` becomes null).
- `POST /api/boards/:id/connections` body `{"sourceNoteId","targetNoteId","kind": "manual","label"?}` → `201 Connection`.
- `DELETE /api/boards/:id/connections/:connectionId` → `204`.

```ts
type Board = { id: string; name: string; viewport: { x: number; y: number; zoom: number };
               cardCount: number; createdAt: string; updatedAt: string }
type Card = { id: string; boardId: string; noteId: string; x: number; y: number; w: number; h: number;
              folded: boolean; sectionId: string | null; z: number; color: string | null }  // color: preset "1".."6" or hex
type Section = { id: string; boardId: string; name: string; x: number; y: number; w: number; h: number; color: string | null }
type Connection = { id: string; boardId: string; sourceNoteId: string; targetNoteId: string;
                    kind: "manual" | "suggested" | "accepted"; label: string | null }
type BoardDetail = Board & { cards: Card[]; sections: Section[]; connections: Connection[]; notes: NoteSummary[] }
```

Edges to draw on a board: every `Link` from `GET /api/links` whose source and target notes both have a card on the board (solid, label "link in Craft"), plus the board's `connections` (manual: solid thin; suggested: dashed, label "suggested").

## Headers
Every response carries `X-Robots-Tag: noindex, nofollow, noarchive` and `Cache-Control: no-store`. `/robots.txt` disallows all.

## Local dev
`npm run dev` starts the Worker + SPA on `http://localhost:5173` (Vite) with the API proxied on the same origin. Fixture mode is on unless `.dev.vars` sets `CRAFT_CONNECTION_URL`. Default dev password is in `.dev.vars.example`.

---

# Phase 2 additions (v2)

Everything below is additive. Phase 1 endpoints are unchanged. All require the session cookie unless noted.

## Canvas objects (text, card, image, pdf, youtube)

Objects are the tool's own content on a board. They are never written to Craft.

```ts
type ObjectKind = "text" | "card" | "image" | "pdf" | "youtube";
type CanvasObject = {
  id: string; boardId: string; kind: ObjectKind;
  x: number; y: number; w: number; h: number; z: number;
  sectionId: string | null; color: string | null;
  title: string | null;        // card title, image/pdf caption, youtube title (filled from oEmbed)
  text: string | null;         // markdown body (text, card); caption/notes (image, pdf, youtube)
  url: string | null;          // youtube: canonical watch URL
  assetId: string | null;      // image, pdf
  meta: Record<string, unknown>; // youtube: {videoId, embedUrl, author, thumbnailUrl}; pdf: {pageCount}; image: {width, height}
  createdAt: string; updatedAt: string;
};
```

- `POST /api/boards/:id/objects` body `{kind, x, y, w?, h?, title?, text?, url?, assetId?, color?, sectionId?}` → `201 CanvasObject`.
  - `youtube` requires `url`; the server resolves it (any youtube.com / youtu.be form), fetches oEmbed metadata and fills `title` and `meta`. `400 invalid_url` otherwise.
  - `image` / `pdf` require `assetId` of a matching asset. `w`/`h` default from the asset's dimensions (image) or 320×420 (pdf).
  - Default sizes: text 240×80, card 280×180, youtube 480×270.
- `PATCH /api/boards/:id/objects/:objectId` body partial `{x,y,w,h,z,sectionId,color,title,text}` → `CanvasObject`. (`kind`, `url`, `assetId` are immutable.)
- `PUT /api/boards/:id/objects` body `{"objects": (Partial<CanvasObject> & {id})[]}` → `{updated}`. Bulk move/resize/fold like cards.
- `DELETE /api/boards/:id/objects/:objectId` → `204`. Removes arrows touching it; the asset stays until deleted explicitly.
- `GET /api/boards/:id` now also returns `objects: CanvasObject[]` and `arrows: Arrow[]`.

## Arrows (relationships the user draws)

```ts
type ArrowEnd = { kind: "card" | "object"; id: string };
type ArrowType = "parent_child" | "related" | "custom";
type Arrow = {
  id: string; boardId: string;
  source: ArrowEnd; target: ArrowEnd;           // direction: source → target (parent → child)
  type: ArrowType; label: string | null; color: string | null;
  sourceHandle: string | null; targetHandle: string | null;  // React Flow handle ids (e.g. "right", "left")
  createdAt: string;
};
```

- `POST /api/boards/:id/arrows` body `{source, target, type?, label?, color?, sourceHandle?, targetHandle?}` → `201 Arrow`. `400` if an endpoint is not on this board or source equals target.
- `PATCH /api/boards/:id/arrows/:arrowId` body partial `{source, target, type, label, color, sourceHandle, targetHandle}` → `Arrow` (re-route by changing an endpoint).
- `DELETE /api/boards/:id/arrows/:arrowId` → `204`.

Rendering rule: Craft links (`GET /api/links`) are solid, neutral, labelled "link in Craft" and cannot be edited. Arrows are user-coloured with an arrowhead, editable label, and a type badge; `parent_child` arrows point from parent to child. The two must never look the same. Phase 1 `connections` endpoints still exist but are superseded by arrows; do not create new connections.

## Uploads and assets

```ts
type Asset = {
  id: string; kind: "image" | "pdf"; filename: string; contentType: string; size: number;
  url: string;                   // "/api/assets/:id" (same-origin, cookie-gated)
  width: number | null; height: number | null;   // images, if the client reported them
  pageCount: number | null;      // pdf, once known
  textStatus: "none" | "pending" | "done";       // pdf text extraction state
  createdAt: string;
};
```

- `POST /api/uploads` multipart form with field `file` (and optional `width`, `height` for images) → `201 Asset`. Limits: images (`image/png`, `image/jpeg`, `image/gif`, `image/webp`) up to 10 MB; PDFs (`application/pdf`) up to 25 MB. Over limit → `413 {error:"too_large", message, limit}`; other types → `415 unsupported_type`.
- `GET /api/assets/:id` → the file bytes with its content type (supports `Range`). Use as `<img src>` and as the pdf.js document URL.
- `GET /api/assets/:id/meta` → `Asset`.
- `PUT /api/assets/:id/text` body `{"pages": [{"page": number, "text": string}], "pageCount": number}` → `{indexed: number}`. The browser extracts PDF text with pdf.js right after upload and posts it here; this is what makes PDF pages searchable and citable. Replaces any previous text.
- `GET /api/assets/:id/text?from=1&to=5` → `{pages: [{page, text}], pageCount}`.
- `DELETE /api/assets/:id` → `204`, or `409` while an object still references it.

## YouTube

- `GET /api/youtube?url=<any youtube url>` → `{videoId, url, embedUrl, title, author, thumbnailUrl}` via YouTube oEmbed (server-side; no key). `400 invalid_url` if it is not a YouTube URL. The object create endpoint does this for you; this endpoint is for previewing before placing.
- Embed with `<iframe src={meta.embedUrl}>` (`https://www.youtube-nocookie.com/embed/<videoId>`), `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"`, `allowfullscreen`.

## Search (shared by the UI and MCP)

- `GET /api/search?q=<text>&limit=20&kinds=note,object,pdf_page` → `{results: SearchResult[]}`.

```ts
type SearchResult = {
  id: string;              // prefixed: "note:<craftId>" | "object:<id>" | "pdf_page:<assetId>:<page>"
  kind: "note" | "object" | "pdf_page";
  objectKind?: ObjectKind; // for kind "object"
  title: string; snippet: string;   // snippet has <mark> around matches
  boardIds: string[];      // boards where it appears (notes: via cards)
  page?: number; assetId?: string;  // pdf_page
  score: number;
};
```

Full-text search with diacritics folded (so "viet" finds "Việt") and prefix matching on each word. The index updates on every write: sync, object create/edit/delete, PDF text upload, asset delete.

## MCP (read-only, for Claude / ChatGPT)

- Endpoint: `POST /mcp` (Streamable HTTP, stateless). Auth: `Authorization: Bearer <MCP_TOKEN>`; without it `401` + `WWW-Authenticate: Bearer`. Experimental fallback for clients that cannot set headers: `POST /mcp/<MCP_TOKEN>`. The session cookie is not used here.
- Tools: `list_boards`, `get_board`, `search`, `fetch`, `get_pdf_pages`, `list_relationships` (see docs/PLAN-PHASE2.md §5). No write tools. `fetch` pages long text: `{id, offset?, maxChars?}` (default 20 000 chars, max 60 000) and returns `textRange: {offset, length, totalChars, truncated, nextOffset}`.
