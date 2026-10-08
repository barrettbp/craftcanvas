# CraftCanvas v1 – Implementation plan (subagent work packages)

Source of truth: `docs/FEATURE_SPEC.md`. This file turns the spec into work packages (WP) that
independent agents can pick up, with clear file ownership so parallel work does not collide.

## Ground rules for every agent

1. **Stack is fixed.** Next.js (App Router, TypeScript, Tailwind), React Flow (`@xyflow/react`),
   Zustand, Clerk (Google only), Drizzle ORM on Postgres (Supabase), Zod, Vitest.
2. **Package manager is pnpm.** Do not add dependencies unless your WP lists them. If you truly
   need one, add it and say so in your final report.
3. **Everything must pass without real credentials.** `pnpm typecheck`, `pnpm lint`, `pnpm test`
   must run green on a machine with no Clerk or Supabase keys. `pnpm build` must pass with the
   placeholder values from `.env.example`. Never make a module throw at import time because an env
   var is missing; read env lazily inside the function that needs it.
4. **Ownership.** Each WP lists the directories it owns. Only touch files outside your ownership
   when the WP says so. Shared contracts live in `src/lib/canvas/types.ts`, `src/lib/craft/types.ts`
   and `src/db/schema.ts`; extend them, do not rewrite them.
5. **Security.** `pdk_` keys never reach the browser, never get logged, never appear in a JSON
   response. Every route handler and server action checks Clerk `auth()` and scopes queries by
   `user_id`. Return 401 when signed out and 404 for another user's canvas.
6. **Do not run `next build` while another agent may be running.** Parallel agents verify with
   typecheck, lint and tests only. The orchestrator runs the build once per phase.
7. **Do not commit.** The orchestrator commits after each phase. Leave the tree in a working state.
8. **Report** what you built, what you verified (commands and results), and anything you skipped.

## Phases

```
Phase 0  WP0 Scaffold                      (one agent, blocks everything)
Phase 1  WP1 Canvas core  ||  WP2 Craft connect     (two agents in parallel)
Phase 2  WP3 Note cards (joins WP1 and WP2)          (one agent)
Phase 3  WP4 Export + thumbnails  ||  WP5 Polish + privacy + hardening   (two agents in parallel)
Phase 4  WP6 QA, acceptance pass, README             (one agent)
```

Spec milestones map as: M0 = WP0, M1 = WP1, M2 = WP2, M3 = WP3, M4 = WP4 + WP5, M5 = WP5 + WP6.

---

## WP0 – Scaffold (spec M0)

Owns: everything. Runs alone.

Deliverables:

- `pnpm create next-app` style project at repo root: App Router, TypeScript, Tailwind, ESLint,
  `src/` directory, import alias `@/*`. Turbopack is fine.
- Install all dependencies the later WPs need so nobody touches `package.json` in parallel:
  runtime: `@xyflow/react`, `zustand`, `@clerk/nextjs`, `drizzle-orm`, `postgres`, `zod`,
  `react-markdown`, `remark-gfm`, `html-to-image`, `svix`, `nanoid`, `@supabase/supabase-js`,
  `lucide-react`, `clsx`;
  dev: `drizzle-kit`, `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`,
  `@testing-library/jest-dom`, `dotenv`.
- Scripts: `dev`, `build`, `start`, `lint`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`),
  `db:generate`, `db:migrate`, `db:push`.
- `src/db/schema.ts` with the four tables from spec section 9 exactly (users, craft_connections,
  craft_documents, canvases) plus the canvases index. `src/db/index.ts` exports a lazy `getDb()`
  that reads `DATABASE_URL` on first call. `drizzle.config.ts`. Generate the first migration into
  `drizzle/`.
- Clerk: `src/proxy.ts` (Next 16 name for middleware; use `middleware.ts` if the installed Next
  version still expects it) with `clerkMiddleware`, public routes `/`, `/privacy`, `/api/webhooks/*`.
  `<ClerkProvider>` in the root layout. `src/app/page.tsx` landing with "Continue with Google"
  (Clerk `<SignInButton>`). `src/app/sign-in/[[...sign-in]]/page.tsx`. Signed-in users are sent to
  `/canvases`. `<UserButton>` in a shared top bar component `src/components/app-shell/TopBar.tsx`.
- `src/app/api/webhooks/clerk/route.ts`: verifies with svix, handles `user.created` (upsert users
  row) and `user.deleted` (delete users row; cascades do the rest).
- Placeholder pages that later WPs replace: `/canvases`, `/canvas/[id]`, `/settings`,
  `/settings/craft`, `/privacy`.
- `src/lib/env.ts`: typed accessors for `DATABASE_URL`, `CLERK_SECRET_KEY`,
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET`, `CRAFT_KEY_ENCRYPTION_SECRET`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_THUMBNAIL_BUCKET`. Lazy, with clear error
  messages.
- `.env.example` with placeholder values that let `pnpm build` succeed
  (for Clerk use a syntactically valid test publishable key such as
  `pk_test_Y2xlcmsuZXhhbXBsZS5jb20k`).
- `vitest.config.ts` with jsdom and one smoke test so `pnpm test` is green.
- `README.md`: how to run locally, env vars, how to set up Clerk (Google), Supabase, Craft.
- `.gitignore` covers `.env*.local`, `.next`, `node_modules`.

Verify: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green using `.env.example`
values copied to `.env.local` (do not commit `.env.local`).

---

## WP1 – Canvas core (spec M1, sections 8.1 to 8.5, 8.7, 9, 10)

Owns: `src/components/canvas/**`, `src/store/**`, `src/lib/canvas/**`, `src/app/canvas/[id]/**`,
`src/app/canvases/**`, `src/app/api/canvases/**`, `src/components/canvas-list/**`,
`src/hooks/**` (canvas related).

Deliverables:

- `src/lib/canvas/types.ts`: TypeScript types for JSON Canvas 1.0 nodes (`text`, `file`, `link`,
  `group`) and edges, plus the `craftcanvas` extension blocks shown in spec section 9. Zod schema
  `canvasDataSchema` in `src/lib/canvas/schema.ts`. Helpers: `emptyCanvas()`, `newId()`.
- Zustand store `src/store/canvas-store.ts`: `nodes`, `edges`, `viewport`, selection, `dirty`,
  `saveState` (`saved | saving | offline | conflict`), undo/redo history (max 100 steps, grouped so
  one drag is one step), actions for add/update/remove node and edge, colour, group wrap.
  Conversion helpers between the JSON Canvas shape and React Flow node/edge objects live in
  `src/lib/canvas/convert.ts`.
- React Flow canvas `src/components/canvas/Canvas.tsx` with custom node components
  `TextNode`, `GroupNode`, and a placeholder `FileNode` (WP3 replaces its internals; keep the
  file and the props contract: it receives the JSON Canvas file node data).
  Edges: custom edge with label, `fromEnd` and `toEnd` arrow markers, colour, selectable, double
  click edits the label, context menu for direction, colour, delete.
- Bottom toolbar (text, note, group, arrow, colour, zoom percent, plus and minus), minimap toggle
  with `M`, left panel slot that is collapsible with `[` (render a placeholder `<NotesPanelSlot>`
  that WP3 fills). Top bar: editable title, save indicator.
- Interactions table in spec 8.5: implement every row. Snap to 8px grid with Alt to disable,
  alignment guides, context menus on canvas, node and edge, Alt drag duplicate, Cmd/Ctrl D.
- Colours: six presets mapped to JSON Canvas ids `"1"` to `"6"` and none. Custom hex accepted in
  the data model.
- Autosave pipeline: dirty flag, 1.5s debounce, `PUT /api/canvases/:id` with `{ data, version }`.
  Server returns 409 when the version moved; client then reloads and shows "Updated in another
  tab". Offline detection queues the save and retries.
- API routes under `src/app/api/canvases`: `GET` list, `POST` create, `GET /:id`, `PUT /:id`
  (autosave with version check), `PATCH /:id` (rename), `POST /:id/duplicate`, `DELETE /:id`.
  Validate bodies with Zod. All scoped by `user_id`.
- `/canvases` page: grid of cards (thumbnail if present, title, updated time), new canvas, inline
  rename, duplicate, delete with confirm, sort by updated, search by title, empty state with a link
  to `/settings/craft` when no Craft connection exists (query the table; it is fine to read
  `craft_connections` here).
- `/canvas/[id]` page: loads the canvas server side (404 if not owned), hydrates the store.
- Unit tests: schema validation, convert round trip, undo/redo grouping, version conflict handling.

Do not touch: `src/lib/craft/**`, `src/app/api/craft/**`, `src/app/settings/**`,
`src/components/notes-panel/**`.

---

## WP2 – Craft connect (spec M2, section 7, 8.6, 9, 11)

Owns: `src/lib/craft/**`, `src/lib/crypto/**`, `src/app/api/craft/**`, `src/app/settings/**`,
`src/components/notes-panel/**`, `src/components/settings/**`.

Deliverables:

- `src/lib/crypto/aes.ts`: AES-256-GCM encrypt and decrypt using `CRAFT_KEY_ENCRYPTION_SECRET`
  (derive a 32 byte key with SHA-256 of the secret, random 12 byte IV, auth tag appended to the
  cipher text). Tests.
- `src/lib/craft/client.ts`: typed wrapper over the Craft Connect API. 10s timeout, retry with
  backoff and jitter on 429 and 5xx (max 3), latency logging, never logs the key. Methods:
  `listFolders()`, `listDocuments(location)`, `searchDocuments(q)`, `getDocumentMarkdown(id)`.
  Types in `src/lib/craft/types.ts`. Tests with a mocked `fetch`.
- `src/lib/craft/connection.ts`: load the user's connection, decrypt the key, build a client.
  Mark `status = unauthorized` when Craft returns 401.
- `src/lib/craft/index.ts`: document indexer. Full refresh (folders, documents, preview of the
  first ~600 characters of markdown), rate limited to once per minute per user, concurrency cap of
  4 preview fetches in flight. Writes `craft_documents`. Marks `missing = true` on 404.
- Routes under `src/app/api/craft`: `connect` (POST: test with `GET /folders`, store encrypted,
  kick off initial index; DELETE: disconnect and wipe index), `folders`, `documents`, `search`
  (local index first, merged with Craft search), `preview/[docId]` (fetch markdown, update index,
  return trimmed `{ title, preview, updatedAt, missing }`), `refresh` (full refresh, 429 if called
  within a minute), `status` (connection status and last sync).
- `/settings` page: connected space, last synced, Disconnect, Delete account (server action that
  deletes canvases, index and key, then calls Clerk backend to delete the user).
- `/settings/craft` page: step by step instructions, two fields, Test connection, Save, progress
  of the initial index.
- Notes panel `src/components/notes-panel/NotesPanel.tsx`: folder tree from `/api/craft/folders`,
  lazy documents per folder, search box (local instantly, Craft after 300ms pause, merged),
  rows with title, folder path, relative updated time, a dot when the doc is already on the
  canvas (prop `docIdsOnCanvas: Set<string>`), drag start sets
  `dataTransfer` type `application/x-craftcanvas-doc` with JSON `{ craftDocId, title, folderPath }`,
  plus icon calls prop `onAddDocument(doc)`. "Refresh notes" button with last synced time.
  Unauthorized state renders the reconnect banner. Panel must not import from `src/store`.
- Unit tests for crypto, client retry, indexer preview trimming, search merge.

Do not touch: `src/components/canvas/**`, `src/store/**`, `src/app/canvas/**`,
`src/app/api/canvases/**`.

---

## WP3 – Note cards (spec M3, section 7 deep links and errors, 8.2 note card, 8.6 drop)

Owns: `src/components/canvas/nodes/FileNode.tsx`, `src/components/canvas/NotesPanelSlot.tsx`,
small edits anywhere needed to wire WP1 and WP2 together.

Deliverables:

- Mount `NotesPanel` in the canvas page's left panel. Pass `docIdsOnCanvas` from the store and
  implement `onAddDocument` (drop at viewport centre) and the drop handler on the React Flow pane
  (drop where the pointer lands, converting screen to flow coordinates).
- `FileNode`: title, folder path, markdown preview clipped to card height, default 320 x 200,
  resizable with min 160 x 80, hover actions (Open in Craft, Refresh, Colour, Remove), double
  click opens in Craft, "2" badge when the same doc appears more than once on the canvas, grey
  "Missing in Craft" state.
- Preview loading: on canvas open, cards whose `indexedAt` is older than 24 hours are refreshed
  lazily, four at a time, via `/api/craft/preview/:id`. Refresh icon forces it.
- Open in Craft: `craftdocs://open?blockId=<docId>&spaceId=<spaceId>` with fallback to a web
  link when the index has one, otherwise a hint toast.
- Reconnect banner on the canvas page when `/api/craft/status` reports `unauthorized`.
- Tests: drop coordinate conversion, duplicate badge count, stale detection.

---

## WP4 – Export and thumbnails (spec M4, sections 4, 9, 8.7)

Owns: `src/lib/export/**`, `src/app/api/canvases/[id]/export/**`, `src/components/canvas/export/**`,
thumbnail bits of `src/app/api/canvases/[id]/route.ts` and the canvas list card.

Deliverables:

- Export `.canvas`: serialise `canvases.data` as JSON Canvas 1.0 with the `craftcanvas` block kept.
  Button in the top bar menu, downloads `<title>.canvas`. Route `GET /api/canvases/:id/export`.
- Export PNG with `html-to-image` from the React Flow viewport, fit to content, 2x scale.
- Thumbnails: on save, debounced to once per 30s, render a small PNG in the browser and `POST` it
  to `/api/canvases/:id/thumbnail`. Server stores it in Supabase Storage when configured, otherwise
  as a data URL in `canvases.thumbnail`. Canvas list shows it.
- Tests: export output validates against `canvasDataSchema`; a sample exported file matches the
  JSON Canvas spec shape (nodes, edges, no unknown top level keys other than `craftcanvas`).

---

## WP5 – Polish, privacy and hardening (spec M4, M5, section 11)

Owns: `src/app/privacy/**`, `src/lib/rate-limit/**`, `src/components/ui/**`,
`src/components/canvas/KeyboardHelp.tsx`, `drizzle/` RLS migration, `src/lib/log.ts`.

Deliverables:

- Keyboard map modal (`?` opens it) listing every shortcut from spec 8.5.
- Empty states (no canvases, no Craft connection, no search results, empty canvas hint) and error
  states (reconnect banner, rate limited toast, offline indicator) using a small toast component
  in `src/components/ui/toast.tsx`.
- Per user per minute rate limit for `/api/craft/*` and `/api/canvases/*` (in memory, keyed by
  `userId`, documented as single instance in v1). Returns 429 with `Retry-After`.
- A migration that enables Supabase RLS on all four tables with policies keyed on
  `auth.uid()` text comparison or on a `request.jwt.claims` user id, documented as a second layer.
- `/privacy` page stating exactly what is stored and for how long (titles, 600 character previews,
  encrypted key, canvases) and how to wipe it.
- Structured logging helper that redacts anything matching `pdk_`.
- Account deletion flow is wired end to end with a confirm dialog (WP2 built the action).

---

## WP6 – QA and acceptance (spec section 15)

Owns: read everything, fix anything small, `README.md`.

- Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Fix failures.
- Walk every acceptance criterion in spec section 15 and record pass, fail or "needs real
  credentials to verify" in `docs/ACCEPTANCE.md`.
- Grep the codebase for any path where the decrypted key could reach a response or a log.
- Check every `src/app/api/**/route.ts` returns 401 when signed out and 404 for foreign ids.
- Update the README with the full setup guide and the list of open questions from spec section 14
  that still need a decision.

---

## Shared contracts

### Drop payload from the notes panel

```ts
// dataTransfer type: "application/x-craftcanvas-doc"
type CraftDocDragPayload = { craftDocId: string; title: string; folderPath: string };
```

### File node data (JSON Canvas `file` node plus extension)

```ts
type FileNode = {
  id: string; type: "file"; x: number; y: number; width: number; height: number;
  color?: string; file: string;
  craftcanvas: { craftDocId: string; connectionId: string; title: string;
                 folderPath?: string; preview?: string; indexedAt?: string;
                 missing?: boolean; updatedAt?: string; webUrl?: string };
};
```

### Preview route response

```ts
type PreviewResponse = { craftDocId: string; title: string; folderPath: string;
                         preview: string; updatedAt: string | null; indexedAt: string;
                         missing: boolean; webUrl?: string };
```

### Autosave

`PUT /api/canvases/:id` body `{ data: CanvasData; version: number }`.
200 `{ version: number; updatedAt: string }`. 409 `{ error: "version_conflict"; version: number }`.
