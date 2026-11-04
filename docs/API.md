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
