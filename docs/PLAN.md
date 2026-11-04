# CraftCanvas: build plan

Written 2026-11-04 by Claude (orchestrator). Source: `craft-canvas-brief.md` (Barrett, 2026-11-04).

CraftCanvas is a private, read-only canvas over Barrett's Craft notes. Each note is a card on an infinite board, existing `block://` links are drawn as arrows, and boards, card positions and sections are saved in the tool's own storage. Nothing is written to Craft.

## 1. Tech stack and why

| Layer | Choice | Why |
|---|---|---|
| Hosting | One Cloudflare Worker: static assets (SPA) + API | Barrett's usual target. One deploy, one URL, secrets stay server-side. Workers with static assets is Cloudflare's current recommendation over Pages. |
| API | Hono (TypeScript) on the Worker under `/api/*` | Tiny, typed bindings, runs unchanged in `wrangler dev` and production. |
| Storage | Cloudflare D1 (SQLite) | Boards, cards, sections and the note cache are relational (one note on many boards, links between notes). KV would force us to hand-roll indexes. Migrations are versioned in `migrations/`. |
| Auth | App password + signed session cookie, enforced by the Worker on every path | No dashboard setup needed. Anonymous visitors never see the app shell, only a login form. Cloudflare Access can be layered on later without code changes. |
| Craft access | Server-side client, `CRAFT_CONNECTION_URL` as a Worker secret | The connection URL is a credential. Never in browser code, repo, chat or logs. |
| Frontend | Vite + React + TypeScript, canvas on `@xyflow/react` (React Flow) | Pan/zoom, draggable nodes, edges, minimap and viewport-only rendering out of the box. Codex owns this and may swap the canvas library if it says so in the room. |
| Tests | Vitest for the Worker (unit + route tests against a local D1 via `@cloudflare/vitest-pool-workers`), Playwright smoke test for login gate | Backend is Claude's; UI checks are the review gate. |
| Dev data | `CRAFT_MODE=fixture` serves bundled sample notes with real-looking `block://` links | Lets the frontend be built and the deploy be tested before the real connection URL exists. |

Suggested relations (phase 5, optional): Workers AI text embeddings (`@cf/baai/bge-m3`) stored in D1 as blobs, cosine similarity computed in the Worker. Cheapest workable option: it is inside the Cloudflare account already, no new vendor, no new key, and the free allocation covers a personal note space. Not built until Barrett says yes.

## 2. Ownership

| Area | Owner | Branch |
|---|---|---|
| Repo, scaffold, Worker, auth, D1 schema, Craft client, sync, API, tests, deploy | Claude | `main` |
| Design, SPA, canvas, login screen, boards UI, side panel, search, sections, minimap | Codex | `codex/frontend` (and `codex/*` follow-ups) |
| Review gate: every Codex commit is reviewed by Claude for secrets, auth bypass, API misuse, build/test pass, before merge to `main` | Claude | — |
| Credentials, Cloudflare login, scope decision, AI decision | Barrett | — |

Contract between the two sides: `docs/API.md`. The frontend talks only to `/api/*` with the session cookie. It never sees Craft.

## 3. Phases and acceptance checks

### Phase 0: Foundation (Claude)
- Scaffold Worker + Vite SPA, `wrangler.jsonc`, D1 migrations, fixture data, auth gate, `docs/API.md`.
- Accept when: `npm run dev` serves the app; a request without a session gets the login page on every path (including `/assets/*`); wrong password is rejected; after login `GET /api/notes` returns fixture notes with links; `npm test` passes.

### Phase 1: Craft import (Claude)
- Craft client with pacing (≤ 1 request per 700 ms), `429 Retry-After` backoff, batched sync (`POST /api/sync` processes N documents per call and returns a cursor), markdown parser for `[text](block://id)` and `invalid:out_of_scope`, deep links.
- Accept when: with a connection URL scoped to a few documents in `.dev.vars`, repeated `POST /api/sync` imports every document, `GET /api/links` lists each note-to-note link, and the parser tests pass. GET requests only.
- Blocked on: Barrett providing the connection URL through `.dev.vars` (local) and `wrangler secret put` (production). This is the spike in the brief.

### Phase 2: Canvas v1 (Codex)
- Login screen; board list (create, rename, delete); infinite pan/zoom canvas; cards with title + preview; arrows for real links styled solid and labelled "link in Craft"; drag to move with debounced save; sections (create, name, move cards in); side panel reading the full note; "Open in Craft" (app deep link, web link fallback); search the cache and add results to the current board; card info showing which boards hold the note; minimap; fold/unfold cards; cap on visible cards with viewport-only rendering.
- Accept when each item above works in the browser against the fixture API, the build is warning-free, no secrets or `craft.do` calls appear in frontend code, and the page sends `X-Robots-Tag: noindex`.

### Phase 3: QA, review, merge (Claude)
- Backend tests green; review Codex branch (diff, build, run, click through); request fixes in the room; merge to `main`.
- Accept when: `npm run build` and `npm test` pass on `main`; a manual pass of the Phase 2 checklist passes.

### Phase 4: Deploy (Claude with Barrett)
- Barrett: `npx wrangler login`, provide `APP_PASSWORD`, `SESSION_SECRET`, `CRAFT_CONNECTION_URL` via `wrangler secret put`.
- Claude: create D1, apply migrations remotely, deploy, verify anonymous visitor is blocked and `noindex` header is present, share the URL.
- Accept when: the production URL shows the login form to an anonymous request, rejects a wrong password, and after login shows Barrett's notes (or fixtures if the Craft secret is not yet set).

### Phase 5: Suggested relations (optional, needs Barrett's yes)
- Embeddings via Workers AI, dashed "suggested" edges, click to accept as a board-only connection.

## 4. Data model (D1)

```
notes        id TEXT PK (Craft document id = root block id), space_id, title, folder_id, folder_name,
             created_at, modified_at, markdown, preview (first 280 chars), deep_link_app, deep_link_web,
             synced_at, deleted INTEGER DEFAULT 0
links        source_note_id, target_block_id, target_note_id (nullable until resolved), label,
             out_of_scope INTEGER, PK (source_note_id, target_block_id)
boards       id TEXT PK, name, viewport_x, viewport_y, viewport_zoom, created_at, updated_at
cards        id TEXT PK, board_id FK, note_id FK, x, y, w, h, folded INTEGER, section_id (nullable), z,
             UNIQUE (board_id, note_id)
sections     id TEXT PK, board_id FK, name, x, y, w, h, color
connections  id TEXT PK, board_id FK, source_note_id, target_note_id, kind ('manual'|'suggested'|'accepted'), label
sync_state   key TEXT PK, value TEXT   (last_sync_at, cursor, scope, mode)
```

Cards reference notes, so one note can sit on many boards (Heptabase model). Links are global facts about notes; connections are board-only.

## 5. Risks and open questions, sorted by what blocks the spike

1. **Craft connection URL** (blocks Phase 1). Not available to Claude. Provide via `.dev.vars` locally and `wrangler secret put CRAFT_CONNECTION_URL` for production. Until then the app runs in fixture mode.
2. **Cloudflare login** (blocks Phase 4). No Wrangler credentials on this machine. Barrett runs `npx wrangler login` once, or exports `CLOUDFLARE_API_TOKEN` with Workers + D1 edit rights.
3. **GitHub** (does not block). No `gh` or SSH key on this machine. The repo stays local; deploy goes through Wrangler directly. A private GitHub remote can be added later.
4. **Rate limits are shared** with every other Craft connection in the space. Sync is batched and paced; a full-space import of a large space takes minutes, not seconds.
5. **Pagination on a large space** is untested. The client treats any cursor/next field defensively and the sync is resumable.
6. **Canvas density**. Viewport-only rendering, folded cards and a visible-card cap are in Phase 2 scope.
7. **Craft Whiteboards and webhooks** are not used. No backlinks endpoint is assumed; incoming links are computed from the cache.

Open decisions for Barrett (same as the brief): scope for the first run (selected documents recommended), hosting confirm (Cloudflare Workers, single password login), layout storage (D1 proposed), AI relations (default no), write-back (default no).
