# CraftCanvas – Feature Spec (v1)

Status: Draft for review
Owner: Barrett
Last updated: 2026-10-04

---

## 1. What we are building

CraftCanvas is a web app that gives Craft.do users an infinite canvas, in the spirit of Obsidian Canvas. People connect their Craft space, pull in their notes, drop them on a board as cards, and draw out how the notes relate to each other with arrows, text and groups.

Each canvas is saved to the person's account. Accounts are handled by Clerk, with Google sign in as the first (and for v1, only) provider.

### One line pitch

"A thinking board for your Craft notes."

### Why

Craft is great for writing single documents but has no spatial view. People who plan projects, map research or sketch out ideas end up jumping to Miro, FigJam or Obsidian and lose the link back to their notes. CraftCanvas keeps the notes as the source of truth in Craft and adds the spatial layer on top.

---

## 2. Who it is for

| Persona | Job to be done | What they need from v1 |
| --- | --- | --- |
| Solo knowledge worker | Lay out research notes and see how they connect | Fast note search, drag to canvas, arrows with labels |
| Project planner | Map tasks, docs and people for a project | Groups, colours, text cards, "open in Craft" |
| Writer / student | Outline a long piece from scattered notes | Preview of note content on the card, re-order freely |

Teams and shared canvases are out of scope for v1 (see section 4).

---

## 3. Guiding principles

1. Craft stays the source of truth for note content. We never store a full copy of someone's notes longer than needed for display and search.
2. The canvas file format is a superset of Obsidian's JSON Canvas spec so people can export and open boards in Obsidian or other tools.
3. Everything a person does on the canvas autosaves. There is no save button.
4. Keyboard first, mouse friendly, works on a laptop trackpad.
5. Simple enough to ship in a few weeks by one or two people.

---

## 4. Scope

### In scope for v1

- Google sign in via Clerk
- Connect one Craft space per account using a Craft API connection (URL plus API key)
- Browse and search Craft documents from a side panel
- Drag a document onto the canvas to create a note card
- Text cards, group boxes, arrows with labels, colours
- Pan, zoom, multi select, snap to grid, undo and redo
- Autosave to the database, canvas list page, rename, duplicate, delete
- Open a note card in Craft (deep link) and refresh its preview
- Export a canvas as a `.canvas` file (JSON Canvas) and as PNG

### Later (v1.x and v2)

- Shared canvases and live multiplayer
- Import a `.canvas` file
- Write back to Craft (create a note from a text card, append to a doc)
- Embed full Craft doc content with scrolling inside the card
- Link cards (URLs with unfurl), image cards
- Craft OAuth once Craft offers it for third party apps
- Mobile and tablet layout

### Out of scope

- Editing Craft note content inside CraftCanvas
- Any AI features (auto layout, summaries) in v1
- Non Google sign in providers (email, Apple) in v1

---

## 5. Key product decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Canvas engine | React Flow (`@xyflow/react`) | Mature, handles nodes, edges, pan and zoom, selection, minimap. Avoids writing our own hit testing. |
| Framework | Next.js (App Router) with TypeScript | Server routes for Craft proxy, easy Clerk integration, deploys to Vercel. |
| Auth | Clerk, Google only | Requested. Clerk also handles sessions and user ids for row ownership. |
| Database | Postgres (Supabase) with Drizzle ORM | Relational fits users to canvases to nodes. Supabase gives a hosted DB and storage for PNG exports. |
| Canvas storage | One JSONB column per canvas holding nodes and edges | Simple, atomic saves, trivial export. Rows for metadata only. Revisit if canvases get huge. |
| Craft auth | Connection URL plus `pdk_` API key, pasted by the user | Craft's public API works this way today. Key is encrypted at rest. See section 7. |
| File format | JSON Canvas with a `craftcanvas` extension block | Interop with Obsidian. |
| Hosting | Vercel plus Supabase | Matches the user's existing tooling. |

---

## 6. Accounts and sign in (Clerk)

### Flow

1. Visitor lands on `/`. Marketing copy, one button: "Continue with Google".
2. Clerk hosted component runs the Google OAuth flow.
3. On first sign in we create a `users` row keyed by Clerk `userId` via a Clerk webhook (`user.created`). We also handle `user.deleted` to remove all their data.
4. Signed in users land on `/canvases`.

### Rules

- Every API route and server action checks `auth().userId` from Clerk. No userId, 401.
- All reads and writes are scoped by `user_id`. There is no admin view in v1.
- Clerk `<UserButton>` in the top right gives profile and sign out.
- Session lifetime and refresh are left to Clerk defaults.

### Settings page (`/settings`)

- Shows connected Craft space, when it was last synced, and a "Disconnect" button.
- "Delete account" removes canvases, cached notes and the Craft key, then calls Clerk to delete the user.

---

## 7. Craft integration

### What Craft gives us

Craft exposes a REST API per "API connection". The user creates one inside Craft (Connections, New API Connection), picks which documents the connection can see (selected docs or the whole space), switches it to API Key mode, and gets:

- A connection URL like `https://connect.craft.do/links/XXXX/api/v1`
- A key starting with `pdk_`

Known endpoints we rely on:

| Endpoint | Use |
| --- | --- |
| `GET /folders` | Build the folder tree in the side panel |
| `GET /documents?location=...` | List documents in a folder or location |
| `GET /documents/search?q=...` | Search across the connection |
| `GET /blocks?documentId=...` with `Accept: text/markdown` | Pull content for the card preview |

Known limits:

- No webhooks. We cannot be told when a note changes, so we poll on demand.
- Rate limits exist but are described as generous. We still cache and batch.
- No public third party OAuth we can confirm today, so the user pastes the key. If Craft ships OAuth, we swap the connect step and keep everything else.
- Access is only to the docs the user included in the connection. We tell them this clearly during setup.

### Connect flow (`/settings/craft` and first run modal)

1. Show step by step instructions with screenshots on how to create the connection in Craft. Recommend "All documents" for the best experience.
2. Two fields: Connection URL, API Key. "Test connection" button hits `GET /folders` through our server.
3. On success, store the key encrypted (AES-256-GCM, key from `CRAFT_KEY_ENCRYPTION_SECRET` env var) and the URL in `craft_connections`.
4. Kick off an initial index (see below). Show progress in the panel.

### Our server as the proxy

The browser never calls Craft directly and never sees the `pdk_` key. All Craft traffic goes through Next.js route handlers under `/api/craft/*`, which decrypt the key per request, call Craft, and return trimmed JSON.

### Document index

To make the side panel fast and searchable we keep a light index of each document the connection can see:

- `craft_doc_id`, `title`, `folder_id`, `folder_path`, `updated_at` (from Craft), `preview` (first ~600 characters of markdown), `indexed_at`

We do not store full note bodies in v1. The preview is enough for the card.

Index refresh:

- Full refresh on connect, and when the user clicks "Refresh notes" in the panel (max once per minute).
- Background refresh of the folder and document list when the panel opens if the last one was more than 15 minutes ago.
- Per card refresh when the user clicks the refresh icon on a note card, or opens a canvas and a card's `indexed_at` is older than 24 hours (fetched lazily, a few at a time, so we stay well under rate limits).

### Deep links

Craft documents open with `craftdocs://open?blockId=<docId>&spaceId=<spaceId>` on desktop and mobile. Each note card has an "Open in Craft" action. If the deep link fails (no app installed) we fall back to the document's web share link when the API gives us one, otherwise we show a hint.

### Error handling

| Case | What the user sees |
| --- | --- |
| Key revoked or 401 from Craft | Banner "Your Craft connection stopped working. Reconnect." Cards keep their last preview. |
| Doc deleted in Craft (404) | Card shows a grey "Missing in Craft" state. Card stays on the canvas so the layout is not broken. |
| Rate limited (429) | Back off with jitter, retry up to 3 times, then show a toast. |
| Network down | Canvas still works from the loaded state. Saves queue and retry. |

---

## 8. The canvas

### 8.1 Layout

```
+------------------------------------------------------------------+
| Logo  Canvas title [edit]              Saved 2s ago   [Share soon] |
+-----------+------------------------------------------------------+
| Notes     |                                                      |
| [search ] |                                                      |
| > Folder  |             infinite canvas                          |
|   Doc A   |                                                      |
|   Doc B   |                                                      |
| > Folder  |                                                      |
|           |                                     [minimap]        |
+-----------+------------------------------------------------------+
|  [T] text  [N] note  [G] group  [A] arrow  [C] colour   100%  +/- |
+------------------------------------------------------------------+
```

- Left panel is collapsible (shortcut `[`). Width remembered per browser.
- Bottom toolbar is the only persistent chrome over the canvas.
- Minimap toggles with `M`.

### 8.2 Node types

All nodes share: `id`, `x`, `y`, `width`, `height`, optional `color`.

**Note card** (`type: "file"` in JSON Canvas, with `file` set to a Craft path and our extension holding the Craft id)

- Shows document title, folder path in small text, and a markdown preview clipped to the card height.
- Default size 320 x 200. Resizable from corners and edges. Min 160 x 80.
- Actions on hover: Open in Craft, Refresh, Colour, Remove from canvas.
- Double click opens the note in Craft.
- Dragging the same doc onto the canvas twice creates a second card. We allow it but show a small "2" badge so people notice.

**Text card** (`type: "text"`)

- Markdown text. Click once to select, double click or Enter to edit.
- Edits with a plain textarea in v1 and renders markdown when not editing. Supports headings, bold, italic, lists, links, inline code.
- Auto grows height while typing unless the user has resized it by hand.

**Group** (`type: "group"`)

- A labelled rectangle behind other nodes. Nodes fully inside a group move with it.
- Label editable inline. Optional background colour at low opacity.
- Groups sit at the bottom of the z order.

**Link card** (`type: "link"`) is deferred to v1.x but we keep the type in the schema so exports and imports round trip.

### 8.3 Edges (arrows)

- Create by dragging from any of the four side handles that appear on hover to another node.
- Properties: `fromSide`, `toSide`, `fromEnd` (none or arrow), `toEnd` (none or arrow), `label`, `color`.
- Default: smooth bezier, arrow at the end, no label.
- Click an edge to select. Double click to edit the label. Delete key removes it.
- Edge context menu: direction (one way, both ways, none), colour, delete.
- Deleting a node removes its edges.

### 8.4 Colours

Six preset swatches matching JSON Canvas preset ids 1 to 6 (red, orange, yellow, green, cyan, purple) plus a "no colour" option. Custom hex is accepted in the data model and on export but the picker only shows presets in v1.

### 8.5 Interactions

| Action | Mouse / trackpad | Keyboard |
| --- | --- | --- |
| Pan | Drag on empty space, or two finger scroll | Space + drag, arrow keys nudge view |
| Zoom | Pinch, or Ctrl/Cmd + scroll | Cmd/Ctrl +, Cmd/Ctrl -, Cmd/Ctrl 0 to reset, Shift 1 to fit all |
| Select | Click. Shift click to add. Drag on empty space with Shift for marquee | Cmd/Ctrl A select all |
| Move | Drag selection | Arrow keys nudge 1px, Shift for 10px |
| Duplicate | Alt drag | Cmd/Ctrl D |
| Delete | Context menu | Delete or Backspace |
| New text card | Double click empty space | T then click, or just T to drop at centre |
| New group | Toolbar | G drags a group rectangle; with a selection, G wraps the selection |
| Connect | Drag from side handle | With two nodes selected, A creates an arrow between them |
| Undo / redo | Toolbar | Cmd/Ctrl Z, Cmd/Ctrl Shift Z |
| Toggle notes panel | Button | `[` |
| Search notes | Click search | Cmd/Ctrl K focuses search |

- Snap to an 8px grid, hold Alt to disable. Toggle in the settings menu.
- Alignment guides appear when a dragged node's edge lines up with a nearby node.
- Right click gives a context menu on canvas, node and edge.

### 8.6 Notes panel

- Folder tree built from `GET /folders`, lazy loading documents per folder.
- Search box runs against our local index first (instant) and against Craft search after a 300ms pause, merging results.
- Each row: title, folder path, relative updated time. Rows already on this canvas show a small dot.
- Drag a row onto the canvas to create a note card where it lands. Clicking the row's plus icon drops the card at the viewport centre.
- "Refresh notes" button at the bottom with the last synced time.

### 8.7 Canvas list (`/canvases`)

- Grid of cards with a thumbnail (PNG snapshot taken on save, debounced to once per 30s), title, updated time.
- New canvas button, rename inline, duplicate, delete with confirm.
- Sort by last updated. Search by title.
- Empty state explains how to connect Craft if not done yet.

---

## 9. Data model

### Tables

```sql
users (
  id            text primary key,          -- Clerk userId
  email         text,
  created_at    timestamptz default now()
)

craft_connections (
  id              uuid primary key,
  user_id         text references users(id) on delete cascade,
  base_url        text not null,           -- https://connect.craft.do/links/XXX/api/v1
  api_key_cipher  bytea not null,          -- AES-256-GCM
  api_key_iv      bytea not null,
  space_id        text,                    -- for deep links, if discoverable
  label           text,
  last_full_sync  timestamptz,
  status          text default 'ok',       -- ok | unauthorized | error
  created_at      timestamptz default now(),
  unique (user_id)                         -- one connection per user in v1
)

craft_documents (
  connection_id  uuid references craft_connections(id) on delete cascade,
  craft_doc_id   text,
  title          text,
  folder_id      text,
  folder_path    text,
  updated_at     timestamptz,
  preview        text,
  indexed_at     timestamptz,
  missing        boolean default false,
  primary key (connection_id, craft_doc_id)
)

canvases (
  id          uuid primary key,
  user_id     text references users(id) on delete cascade,
  title       text not null default 'Untitled canvas',
  data        jsonb not null,              -- JSON Canvas document, see below
  version     integer not null default 1,  -- optimistic concurrency
  thumbnail   text,                        -- storage path
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
)
create index on canvases (user_id, updated_at desc);
```

### Canvas JSON (`canvases.data`)

Follows JSON Canvas 1.0. Our extras live under `craftcanvas` keys so other tools ignore them.

```json
{
  "nodes": [
    {
      "id": "n1", "type": "file", "x": 0, "y": 0, "width": 320, "height": 200,
      "file": "craft/My Project/Research notes.md",
      "color": "4",
      "craftcanvas": { "craftDocId": "abc123", "connectionId": "...", "title": "Research notes" }
    },
    { "id": "n2", "type": "text", "x": 400, "y": 0, "width": 240, "height": 120, "text": "## Key question\nWhy does..." },
    { "id": "g1", "type": "group", "x": -40, "y": -60, "width": 720, "height": 320, "label": "Phase 1" }
  ],
  "edges": [
    { "id": "e1", "fromNode": "n1", "toNode": "n2", "fromSide": "right", "toSide": "left", "toEnd": "arrow", "label": "supports" }
  ],
  "craftcanvas": { "viewport": { "x": 0, "y": 0, "zoom": 1 }, "grid": true }
}
```

Export writes this object as a `.canvas` file. The `file` path is a best effort folder path so Obsidian shows something sensible even without the note.

---

## 10. Architecture

```
Browser (Next.js client, React Flow, Zustand store)
   |  server actions / fetch
Next.js server (Vercel)
   |-- /api/canvases/*          CRUD, autosave, export
   |-- /api/craft/connect       test + store key
   |-- /api/craft/folders       proxy + cache
   |-- /api/craft/documents     proxy + index
   |-- /api/craft/search        local index + Craft search
   |-- /api/craft/preview/:id   fetch markdown, update index
   |-- /api/webhooks/clerk      user.created / user.deleted
   |
Postgres (Supabase)  +  Supabase Storage (thumbnails)
   |
Craft Connect API (connect.craft.do)
```

### Client state

- Zustand store holds `nodes`, `edges`, `viewport`, `selection`, `history` (undo stack of up to 100 steps).
- React Flow is the renderer. Custom node components for `file`, `text`, `group`.
- Save pipeline: any change marks the store dirty, a 1.5s debounce posts the full `data` with the current `version`. Server rejects with 409 if the version moved (another tab). Client then reloads and shows "Updated in another tab".
- A "Saved / Saving / Offline" indicator in the top bar.

### Server

- Route handlers use Drizzle. All queries include `user_id` from Clerk.
- Craft client module: typed wrapper, 10s timeout, retry with backoff on 429 and 5xx, logs latency.
- Preview fetches are limited to 4 in flight per user.

---

## 11. Security and privacy

- Craft API keys are encrypted at rest with a server side secret and never sent to the browser or logged.
- All Craft calls happen server side. Responses are trimmed to the fields we need.
- We store titles and short previews only. Users can wipe the index and key at any time from settings.
- Clerk handles passwords and OAuth tokens, so we store none.
- Row level ownership checks on every query. Add Supabase RLS as a second layer even though the app talks to Postgres with a service role.
- Rate limit our own public routes (per user, per minute) to protect the Craft key from abuse from a hijacked session.
- Privacy page states exactly what we store and for how long.

---

## 12. Non functional targets

| Area | Target |
| --- | --- |
| Canvas load | Under 1.5s to interactive for a canvas with 200 nodes |
| Frame rate | 60fps panning with 300 nodes on a 2020 MacBook Air |
| Autosave | Change to saved in under 3s on a normal connection |
| Craft search | Local results under 100ms, Craft results merged within 1s |
| Availability | Vercel and Supabase defaults, no SLA promise in v1 |
| Browsers | Latest Chrome, Safari, Firefox, Edge on desktop |

---

## 13. Milestones

| Milestone | Scope | Rough effort |
| --- | --- | --- |
| M0 Scaffold | Next.js, Clerk Google sign in, Supabase schema, deploy to Vercel | 2 to 3 days |
| M1 Canvas core | React Flow, text cards, groups, edges, colours, undo, autosave, canvas list | 1 week |
| M2 Craft connect | Connection setup, encrypted key, folder tree, document index, search | 4 to 5 days |
| M3 Note cards | Drag to canvas, preview, refresh, open in Craft, missing state | 3 to 4 days |
| M4 Polish | Export .canvas and PNG, thumbnails, keyboard map, empty states, error states | 3 to 4 days |
| M5 Beta | Privacy page, account deletion, logging, invite 10 Craft users | 2 days |

About four to five weeks for one developer working full time.

---

## 14. Open questions

1. Does Craft offer third party OAuth for apps yet? If so, we should use it instead of pasted keys. Needs a check against the Craft developer docs, which were not reachable from this environment.
2. Can we discover `spaceId` from the API for deep links, or do we ask the user to paste a Craft link once so we can parse it?
3. Should a connection with "Selected documents" scope be allowed, or do we push people to "All documents"? Leaning: allow it, show a notice.
4. Is a 600 character preview enough, or do people want the whole note scrollable in the card? Decide after beta feedback.
5. Thumbnails: generate in the browser on save, or server side with Playwright? Browser is simpler and costs nothing.
6. Multi connection support (two Craft spaces) is cheap at the schema level. Do we want it in v1?

---

## 15. Acceptance criteria for v1

- A new user can sign in with Google, connect Craft, and have a note card on a canvas within three minutes.
- Refreshing the page restores the canvas exactly, including viewport.
- Deleting a doc in Craft does not break the canvas. The card shows the missing state.
- Revoking the key in Craft shows the reconnect banner within one panel refresh.
- Exported `.canvas` file opens in Obsidian with the same layout, text and arrows.
- No Craft API key is ever present in a network response to the browser (checked in review).
- All routes return 401 when signed out and 404 for another user's canvas id.
