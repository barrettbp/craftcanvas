# CraftCanvas v1 – Acceptance record (WP6)

Source: `docs/FEATURE_SPEC.md` section 15. Reviewed against the code at the end of WP6, with
`pnpm typecheck && pnpm lint && pnpm test && pnpm build` green (35 test files, 279 tests).

No real Clerk, Supabase or Craft credentials were available during this pass, so nothing below is
marked "pass" on the strength of a live run. The statuses are:

- **pass (code review + tests)**: the behaviour is implemented and covered by unit tests, and the
  code path was read end to end.
- **needs real credentials**: the code path exists and is reviewed, but the criterion can only be
  shown with a Google account, a Craft API connection or a deployed Supabase project.
- **needs manual check**: no credentials needed, but a human must do something outside this repo
  (for example open a file in Obsidian).
- **fail**: not met.

## Section 15 criteria

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | A new user can sign in with Google, connect Craft, and have a note card on a canvas within three minutes. | needs real credentials | Flow exists end to end: `src/app/page.tsx` (`<SignInButton>`), `src/proxy.ts` (public `/`, `/sign-in`), `src/app/canvases/page.tsx` + `src/components/canvas-list/CanvasList.tsx` (empty state links to `/settings/craft`), `src/app/settings/craft/page.tsx` + `src/components/settings/CraftConnectForm.tsx` (test, save, index progress), `src/app/api/craft/connect/route.ts`, `src/components/notes-panel/NotesPanel.tsx` (drag + plus icon), `src/components/canvas/Canvas.tsx` `onDrop`, `src/components/canvas/NotesPanelSlot.tsx`. Tests: `NotesPanel.test.tsx` ("loads folders, lazily loads documents, sets the drag payload and calls onAddDocument"), `src/lib/canvas/drop.test.ts`, `src/store/canvas-store.test.ts` ("adds a file node from the notes panel contract"). The three minute budget and the real Craft response shapes (see `src/lib/craft/normalise.ts` header) cannot be verified without an account. |
| 2 | Refreshing the page restores the canvas exactly, including viewport. | pass (code review + tests) | Viewport is written on `onMoveEnd` (`Canvas.tsx` → `setViewport`, marks dirty) into `craftcanvas.viewport` and saved by the autosave pipeline (`src/hooks/useAutosave.ts`, `src/lib/canvas/autosave.ts`, flushed with `keepalive` on hide/unload). `/canvas/[id]/page.tsx` loads the row server side and `CanvasEditor` hydrates the store; `Canvas.tsx` passes `defaultViewport={initialViewport}` from the store. Tests: `canvas-store.test.ts` ("hydrates nodes, edges, viewport and grid and starts clean", "persists the viewport without creating an undo step", "round trips through getCanvasData"), `src/lib/canvas/convert.test.ts` ("fromFlow(toFlow(doc)) equals the document", "is stable under repeated conversion"), `src/lib/canvas/autosave.test.ts`, `src/app/api/canvases/[id]/route.test.ts` (PUT saves and bumps version). Caveat: auto sized text cards take their height from the DOM after reload (`convert.ts` `initialHeight`), so a card's height is re-measured rather than read back; the layout is the same, the stored number may differ by a pixel. |
| 3 | Deleting a doc in Craft does not break the canvas. The card shows the missing state. | pass (code review + tests) | `src/lib/craft/client.ts` maps a 404 to `CraftNotFoundError` without retrying; `src/lib/craft/indexer.ts` `refreshDocument` flags the row `missing: true`, keeps the stored preview and resolves normally; `src/app/api/craft/preview/[docId]/route.ts` answers 200 with `missing: true`; `src/lib/craft/preview-client.ts` `mergePreview` keeps the last preview; `src/components/canvas/nodes/FileNode.tsx` renders the grey "Missing in Craft" badge and keeps the card in place. A full refresh also marks documents that vanished from the listing (`runFullRefresh` step 6). Tests: `FileNode.test.tsx` ("renders the missing state without a badge"), `preview-client.test.ts` ("keeps the last preview and title when the document went missing"), `client.test.ts` ("does not retry 401, 404 or other 4xx"). Assumes Craft answers 404 for a deleted document; confirm on the manual checklist. |
| 4 | Revoking the key in Craft shows the reconnect banner within one panel refresh. | pass (code review + tests) | `client.ts` maps 401/403 to `CraftUnauthorizedError` (no retry); `src/lib/craft/connection.ts` `runWithConnection` sets `status = unauthorized` on the row; every `/api/craft/*` route answers `403 craft_unauthorized` (`src/lib/craft/api.ts`) and `/api/craft/status` reports `status: "unauthorized"`. `NotesPanel.tsx` raises its banner on the status response or on any 403 from folders, documents, search or refresh; `src/hooks/useCraftPreviews.ts` raises the canvas level banner (`CanvasEditor.tsx` → `ReconnectBanner`) from the status call or a 403 on a preview. The panel hides its own banner while the canvas one is visible (`hideReconnectBanner`, WP6). Cards keep their last preview because nothing clears `craftcanvas.preview` on a 403. Tests: `NotesPanel.test.tsx` ("renders the reconnect banner when the connection is unauthorized"), `client.test.ts` ("treats 403 as unauthorized"). |
| 5 | Exported `.canvas` file opens in Obsidian with the same layout, text and arrows. | needs manual check | `src/lib/export/canvas-file.ts` emits only `nodes`, `edges` and the top level `craftcanvas` block, validated by `canvasDataSchema`; `src/app/api/canvases/[id]/export/route.ts` serves it as `<title>.canvas`; `src/components/canvas/export/ExportMenu.tsx` serialises the store directly. Tests: `src/lib/export/canvas-file.test.ts` ("has only nodes, edges and craftcanvas at the top level", "validates against canvasDataSchema and round trips through JSON", "keeps file paths and per node craftcanvas extensions"), `export/route.test.ts`. What is not verified here: Obsidian itself. Expectation: text cards, groups, edge geometry, labels, colours and arrow ends render identically; note cards show as `file` nodes pointing at `craft/<folder>/<title>.md`, which Obsidian draws as a missing file card at the right position. |
| 6 | No Craft API key is ever present in a network response to the browser (checked in review). | pass (code review + tests) | Grep of `api_key_cipher`, `apiKeyCipher`, `apiKey`, `decrypt(` and `pdk_` over `src/`: the cipher/IV columns are read only in `src/lib/craft/connection.ts` (`getConnectionForUser`) and written only in `src/app/api/craft/connect/route.ts`; `decrypt(` is called once, in `connection.ts`, and the plaintext goes straight into the `createCraftClient` closure (`client.ts`), which only uses it for the `Authorization` header. `SafeConnection` has no cipher or IV fields; `/api/craft/status` and the settings pages hand pick fields; the connect route returns `{ ok, dryRun, host, label, folderCount, connection: { id, status } }`. No client component reads a key; `CraftConnectForm.tsx` holds the user's own input in state and clears it after save. Errors never echo input: `invalidRequest` returns zod paths and messages only, `craftErrorResponse` returns fixed strings. Logging goes through `src/lib/log.ts`, which replaces every `pdk_…` token; `client.ts` additionally redacts error messages before they become `CraftNetworkError`. WP6 replaced the five remaining bare `console.error` calls with the redacting logger. Tests: `client.test.ts` ("retries network errors and never leaks the key in the message", "logs latency and never the key", "redactKey masks pdk_ keys"), `src/lib/log.test.ts`, `src/lib/crypto/aes.test.ts` ("round trips a pdk_ key", cipher text does not contain the key). |
| 7 | All routes return 401 when signed out and 404 for another user's canvas id. | pass (code review + tests) | Every `src/app/api/**/route.ts` except the Clerk webhook calls `auth()` first and answers 401 (`jsonError(401, "unauthorized")` for canvases, `unauthenticated()` for craft). **WP6 fix:** `src/proxy.ts` used `auth.protect()` for API routes, and Clerk's `protect()` answers a signed-out non-page request with a 404 rewrite, which would have hidden the handlers' 401; the middleware now answers `401 { error: "unauthorized" }` itself for non-public `/api/*` routes. Ownership: `src/lib/canvas/repo.ts` scopes every query by `user_id`, so a foreign id and a missing id are both 404 (`isOwnedBy` comment in `src/lib/canvas/api.ts`); `src/app/canvas/[id]/page.tsx` calls `notFound()`. Tests: `src/app/api/canvases/[id]/route.test.ts` ("returns 401 when signed out", "returns 404 when the canvas is missing or owned by someone else", "GET returns the document for the owner and 404 otherwise", "DELETE returns ok for the owner and 404 otherwise"), `export/route.test.ts` and `thumbnail/route.test.ts` (same two cases). The `/api/craft/*` handlers have no route level tests; their 401 path is one shared helper (`currentUserId` + `unauthenticated` in `src/lib/craft/api.ts`) and was read in every file. |

Summary: 5 pass (code review + tests), 1 needs real credentials, 1 needs manual check, 0 fail.

## How to verify manually (credential dependent)

Set up `.env.local` from the README (Clerk with Google, Supabase Postgres with migrations applied,
`CRAFT_KEY_ENCRYPTION_SECRET`), run `pnpm dev`, then:

1. **Sign in and connect (criterion 1).** Start a timer. Open `/`, press "Continue with Google".
   You should land on `/canvases` with the "Craft is not connected yet" note. Open Settings >
   Connect Craft, paste a connection URL and `pdk_` key, press "Test connection" (expect
   "Connected to connect.craft.do: N folders visible"), then "Save and index". Watch the document
   count climb, then "Go to canvases", "New canvas", and drag a row from the panel onto the board.
   Stop the timer: the whole thing should be well under three minutes.
2. **Confirm Craft response shapes.** While connected, open the browser network tab and look at
   `/api/craft/folders`, `/api/craft/documents`, `/api/craft/search?q=…` and
   `/api/craft/preview/<id>`. Every row should have a real title and folder path, documents
   should show a relative updated time, and previews should be markdown rather than JSON. If any
   of these are empty or "Untitled", capture the raw Craft payload (temporarily log
   `res.body` in `src/lib/craft/client.ts` `request()`) and adjust the key lists in
   `src/lib/craft/normalise.ts`; the checklist in its header lists every assumption.
3. **Refresh restores the canvas (criterion 2).** Add a text card, a note card, a group and an
   arrow with a label, pan and zoom somewhere unusual, wait for "Saved", reload. Everything
   including the viewport should come back as it was. Also try reloading within a second of a pan:
   the `keepalive` flush should still land.
4. **Deleted document (criterion 3).** Put a note card on a canvas, delete (or move to trash) that
   document in Craft, press the card's refresh icon. The card should turn grey with "Missing in
   Craft" and keep its last preview. Note what Craft actually returns for the deleted id (expected
   404) in the network tab; if it returns 200 with an error body, `client.ts` `errorForStatus`
   needs a case for it.
5. **Revoked key (criterion 4).** Delete or regenerate the API connection in Craft. In CraftCanvas
   press "Refresh notes" (or just open a canvas with a stale card). The red reconnect banner should
   appear once, at the top of the canvas page (not twice), cards keep their previews, Settings
   shows "Needs reconnect", and `/api/craft/status` reports `status: "unauthorized"`. Reconnect
   from Settings > Connect Craft and confirm the banner clears on the next panel load.
6. **Obsidian (criterion 5, no credentials needed).** Export a canvas with every node type, open
   the `.canvas` file in an Obsidian vault, compare positions, sizes, colours, text, group labels,
   edge sides, arrow heads and edge labels.
7. **Key never reaches the browser (criterion 6).** With the network tab open, go through connect,
   browse, search, preview and export. Filter responses for `pdk_`: there must be no hit. Also
   check the server log for `pdk_[redacted]` only.
8. **401 and 404 (criterion 7).** Signed out, `curl -i http://localhost:3000/api/canvases` must
   return 401 JSON (not a redirect and not 404). Signed in as user A, create a canvas and copy its
   id; signed in as user B, `GET /api/canvases/<id>`, `PUT`, `PATCH`, `DELETE`,
   `/export`, `/thumbnail` and `/duplicate` must all be 404, and `/canvas/<id>` must render the
   not found page.
9. **Thumbnails with Supabase Storage.** Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and a
   public read bucket, edit a canvas, wait for a save, and check the canvas list shows the PNG
   from the storage URL. Leave both blank to confirm the data URL fallback.
10. **Clerk webhook.** Point a Clerk webhook (via `ngrok`) at `/api/webhooks/clerk` with
    `user.created` and `user.deleted`, sign up a throwaway account, confirm the `users` row
    appears; delete the user in Clerk, confirm the row and everything that cascades from it is gone.

## Spec walk-through (sections 7, 8.2, 8.3, 8.5, 8.6, 8.7)

Legend: ✓ implemented and reviewed, ~ implemented with a noted deviation, ✗ missing.

### 8.5 Interactions

| Action | Mouse / trackpad | Keyboard | Where |
| --- | --- | --- | --- |
| Pan | ✓ drag on empty space (`panOnDrag=[0,1]`), two finger scroll (`panOnScroll`) | ✓ Space + drag (`panActivationKeyCode`), arrow keys pan the view when nothing is selected | `Canvas.tsx`, `useCanvasShortcuts.ts` |
| Zoom | ✓ pinch (`zoomOnPinch`), Ctrl/Cmd + scroll (`zoomActivationKeyCode` with `zoomOnScroll=false`) | ✓ Mod =, Mod -, Mod 0, Shift 1 | same |
| Select | ✓ click, Shift click adds (`multiSelectionKeyCode`), Shift drag marquee (`selectionKeyCode`) | ✓ Mod A | same |
| Move | ✓ drag selection | ✓ arrows 1px, Shift 10px, coalesced into one undo step | `useCanvasShortcuts.ts`, store `nudgeSelected` |
| Duplicate | ✓ Alt drag (clones left in place, originals keep dragging, one undo step) | ✓ Mod D | `Canvas.tsx` `onNodeDragStart`, store `duplicateNodes` |
| Delete | ✓ context menu | ✓ Delete / Backspace | `ContextMenu.tsx`, store `removeSelected` |
| New text card | ✓ double click empty space; toolbar Text tool then click | ~ `T` drops at the viewport centre and starts editing; "T then click" is only available through the toolbar tool | `Canvas.tsx` `onPaneDoubleClick`, `ToolOverlay.tsx` |
| New group | ✓ toolbar tool, drag a rectangle or click for a default one | ✓ `G` toggles the tool; with a selection `G` wraps it | `ToolOverlay.tsx`, store `wrapSelectionInGroup` |
| Connect | ✓ drag from any of the four side handles (loose connection mode) | ✓ `A` with exactly two nodes selected | `NodeHandles.tsx`, store `connectSelected` |
| Undo / redo | ✓ toolbar | ✓ Mod Z, Shift Mod Z (and Mod Y) | `Toolbar.tsx`, store history |
| Toggle notes panel | ✓ toolbar button and settings menu | ✓ `[` | `LeftPanel.tsx` |
| Search notes | ✓ click the search box | ✓ Mod K (and `N`) | `focusNotesSearch` |
| Snap to 8px grid, Alt to disable, toggle in settings menu | ✓ | ✓ | `Canvas.tsx` `snapToGrid={grid && !altHeld}`, `Toolbar.tsx` settings |
| Alignment guides | ✓ edges and centres of a single dragged node snap to neighbours | | `Canvas.tsx` `handleNodesChange`, `src/lib/canvas/helper-lines.ts` |
| Right click menus on canvas, node and edge | ✓ | | `ContextMenu.tsx` |
| Keyboard map (`?`) | ✓ every row above is listed | | `KeyboardHelp.tsx`, `shortcuts-table.ts` |

### 8.2 Node types

| Requirement | Status | Where |
| --- | --- | --- |
| Note card shows title, folder path, markdown preview clipped to the card | ✓ | `FileNode.tsx`, `MarkdownView.tsx` |
| Default 320 x 200, resizable from corners and edges, min 160 x 80 | ✓ | `DEFAULT_SIZES` / `MIN_SIZES` in `src/lib/canvas/types.ts`, `NodeResizer` |
| Hover actions: Open in Craft, Refresh, Colour, Remove | ✓ (also visible while selected, and focusable) | `FileNode.tsx`, `canvas.css` |
| Double click opens in Craft | ✓ with web link fallback and a hint when neither works | `src/lib/craft/deep-link.ts` |
| Same doc twice shows a "2" badge | ✓ | `selectDocCount`, `FileNode.test.tsx` |
| Grey "Missing in Craft" state | ✓ | `FileNode.tsx` |
| Text card: markdown, click selects, double click or Enter edits in a textarea | ✓ | `TextNode.tsx`, `useCanvasShortcuts.ts` (Enter) |
| Headings, bold, italic, lists, links, inline code | ✓ `react-markdown` + `remark-gfm`; links open in a new tab | `MarkdownView.tsx` |
| Auto grows while typing unless resized by hand | ✓ `manualSize` flag, persisted in the text node's `craftcanvas` block | `TextNode.tsx`, `convert.ts` |
| Group: labelled rectangle behind other nodes; nodes fully inside move with it | ✓ smallest containing group becomes the React Flow parent | `convert.ts` `assignParents`, `convert.test.ts` |
| Group label editable inline, low opacity colour | ✓ | `GroupNode.tsx` |
| Groups at the bottom of the z order | ✓ `zIndex` 0 vs 1 and ordered first | `convert.ts` |
| Link card type kept in the schema for round trips | ✓ schema, store and a placeholder renderer | `schema.ts`, `LinkNode.tsx` |

### 8.3 Edges

| Requirement | Status | Where |
| --- | --- | --- |
| Create by dragging from any of four side handles that appear on hover | ✓ handles fade in on hover, selection, or while connecting | `NodeHandles.tsx`, `canvas.css` |
| `fromSide`, `toSide`, `fromEnd`, `toEnd`, `label`, `color` | ✓ | `types.ts`, `convert.ts` `edgeToFlow` / `edgeFromFlow` |
| Default smooth bezier, arrow at the end, no label | ✓ | `CanvasEdge.tsx`, `decorateEdge` |
| Click selects, double click edits the label, Delete removes | ✓ | `CanvasEdge.tsx`, `Canvas.tsx` `onEdgeDoubleClick` |
| Context menu: direction (one way, both, none), colour, delete | ✓ plus add/edit label | `ContextMenu.tsx`, store `setEdgeDirection` |
| Deleting a node removes its edges | ✓ | store `removeNodes`, `canvas-store.test.ts` ("removes nodes together with their edges") |
| Self connections refused, duplicate edges refused | ✓ | `Canvas.tsx` `isValidConnection`, store `addEdge` |

### 8.6 Notes panel

| Requirement | Status | Where |
| --- | --- | --- |
| Folder tree from `GET /folders`, lazy documents per folder | ✓ | `NotesPanel.tsx` `toggleFolder` → `/api/craft/documents?location=` |
| Search: local index instantly, Craft after a 300ms pause, merged | ✓ `scope=local` first, then the merged call; de-duplicated by id, local first | `NotesPanel.tsx`, `src/app/api/craft/search/route.ts`, `src/lib/craft/search.ts` |
| Each row: title, folder path, relative updated time | ~ tree rows show title and time; the folder path is in the row's tooltip and implied by the tree. Search result rows show the path inline. | `NotesPanel.tsx` `DocRow` `showPath` |
| Dot on rows already on this canvas | ✓ | `docIdsOnCanvas` from `selectDocIdsOnCanvas` |
| Drag a row onto the canvas, drop where it lands; plus icon drops at the viewport centre | ✓ | `Canvas.tsx` `onDrop`, `NotesPanelSlot.tsx` `onAddDocument` |
| "Refresh notes" with last synced time, max once per minute | ✓ 429 with `retryAfter` shown inline | `NotesPanel.tsx`, `src/app/api/craft/refresh/route.ts` |
| Background refresh when the panel opens and the index is older than 15 minutes | ✓ `POST /api/craft/refresh?ifStale=1` | `NotesPanel.tsx` initial effect |
| Reconnect banner, "not connected" state, no results, empty folder, connection scope hint | ✓ | `NotesPanel.tsx` |

### 8.7 Canvas list

| Requirement | Status | Where |
| --- | --- | --- |
| Grid of cards with thumbnail, title, updated time | ✓ | `CanvasList.tsx`, `CanvasCard.tsx` |
| Thumbnail PNG taken on save, debounced to once per 30s | ✓ | `useThumbnail.ts`, `thumbnail-scheduler.ts` (+ test) |
| New canvas, inline rename (double click the title or menu), duplicate, delete with confirm | ✓ optimistic updates with rollback on error | `CanvasList.tsx`, `CanvasCard.tsx` |
| Sort by last updated, search by title | ✓ | `sortByUpdated`, `filterByTitle` (+ tests) |
| Empty state explains how to connect Craft | ✓ amber note when there is no connection, plus the "No canvases yet" empty state | `CanvasList.tsx`, `CanvasList.test.tsx` |

### Section 7 error handling

| Case | Spec | Status | Where |
| --- | --- | --- | --- |
| Key revoked or 401 from Craft | Banner, cards keep their last preview | ✓ | see criterion 4 |
| Doc deleted (404) | Grey "Missing in Craft", card stays | ✓ | see criterion 3 |
| Rate limited (429) | Back off with jitter, retry up to 3 times, then a toast | ✓ server: exponential backoff with full jitter, honours `Retry-After`, max 3 retries, then `429 craft_rate_limited`; client: `toastRateLimited` from the panel, preview queue and autosave (de-duplicated) | `client.ts`, `client.test.ts` ("retries on 429 then succeeds, honouring Retry-After", "gives up after 3 retries on 429"), `toast.tsx` |
| Network down | Canvas keeps working, saves queue and retry | ✓ offline save state, retry every 5s and on `online`, offline/online toasts | `autosave.ts` (+ tests "goes offline when fetch throws and retries later", "does not call the network while navigator is offline"), `toast.tsx` `useConnectivityToasts` |
| Craft unreachable while browsing | (not in the table) | ✓ documents route falls back to the local index (`source: "local"`), search returns local rows with `craftError` | `documents/route.ts`, `search/route.ts` |
| Unparsable Craft response | should not 500 | ✓ non JSON body → `CraftRequestError` → `502 craft_error`; unknown JSON shape → empty list | `client.ts` `parseJson`, `normalise.ts`, `api.ts` `craftErrorResponse` |
| Another tab saved first (409) | Reload and show "Updated in another tab" | ✓ | `autosave.ts` (+ test), `useAutosave.ts`, `SaveIndicator.tsx` |

## Security and auth review notes (WP6)

- Decrypted key: lives only inside `src/lib/craft/connection.ts` (`getConnectionForUser`) and the
  `createCraftClient` closure in `src/lib/craft/client.ts`. It is never returned, never put in a
  response, never stored on a client object, never logged. `SafeConnection` carries
  `id, userId, baseUrl, host, spaceId, label, lastFullSync, status, createdAt` only.
- Auth: every `/api/canvases/*` and `/api/craft/*` handler, every server page (`/canvases`,
  `/canvas/[id]`, `/settings`, `/settings/craft`) and the `deleteAccount` server action call Clerk
  `auth()` first. Routes answer 401, pages redirect to `/sign-in`, `/canvas/[id]` answers 404 for
  a missing or foreign id. The middleware now answers 401 for API routes itself (see criterion 7).
- Query scoping: `src/lib/canvas/repo.ts` filters every statement by `user_id`;
  `src/lib/craft/connection.ts` loads the connection by `user_id` and every `craft_documents`
  query in `indexer.ts`, `documents/route.ts` and `search/route.ts` filters by that connection's
  id; `connect/route.ts` and `settings/actions.ts` filter by `user_id`. `setConnectionStatus` and
  `markUnauthorized` update by connection id only, but the id always comes from a row that was
  just loaded for the current user.
- Webhook: `/api/webhooks/clerk` is the only public API route and verifies the svix signature
  (`Webhook.verify`) before parsing the payload; a bad signature is 400.
- SSRF: the connect route only accepts `https://` URLs on `craft.do` hosts.
- Row level security migration (`drizzle/0001_rls.sql`) is a second layer; the app connects as the
  table owner, which bypasses it, and documents that.
- Rate limiting: all `/api/canvases/*` (including `export`, `thumbnail` and `duplicate`) and
  `/api/craft/*` handlers call `rateLimited(userId, bucket)` after auth. In memory, single
  instance (see README).

## Known gaps and follow ups

Larger than a WP6 fix; listed with a suggested next step.

1. **Craft response shapes are assumed, not confirmed.** `src/lib/craft/normalise.ts` accepts
   several plausible key names per field. Follow up: run manual check 2 above with a real
   connection, pin the confirmed shape in `normalise.test.ts`, and remove the alternatives that
   never occur.
2. **`spaceId` is not reliably discovered** (spec section 14, question 2). `extractSpaceId` looks
   for it in the `/folders` payload; when absent the deep link is `craftdocs://open?blockId=<id>`
   without `spaceId`, which Craft may or may not resolve. Follow up: confirm with the real API;
   if it is never present, add a one time "paste any Craft link" field in `/settings/craft` and
   parse the space id out of it.
3. **No browser or end to end tests.** Interactions (drag, resize, marquee, context menus, deep
   links) are verified by code review and unit tests of the store and helpers only. Follow up: a
   Playwright smoke test against a seeded database for the flows in the manual checklist.
4. **`/api/craft/*` routes have no handler level tests** (the canvases routes do). The shared
   helpers are tested. Follow up: add `route.test.ts` next to each, mocking `@/lib/craft/connection`
   the way the canvases tests mock the repo, covering 401, 404 `not_connected`, 403
   `craft_unauthorized` and 502.
5. **Rate limiter is per process.** On Vercel each function instance counts separately. Follow
   up: move the sliding window to Upstash Redis when the app runs on more than one instance.
6. **Connect flow screenshots are placeholders.** `/settings/craft` reserves space for images of
   Craft's Connections screen (`src/app/settings/craft/page.tsx`). Follow up: capture them once a
   Craft account is available.
7. **Server side preview concurrency is per full refresh, not per user across requests.** The
   indexer caps preview fetches at 4 during a full refresh and the browser caps `/api/craft/preview`
   calls at 4 in flight; two tabs could reach 8. Follow up: a small per user semaphore in
   `preview/[docId]/route.ts` if Craft rate limits bite.
8. **Obsidian interop is untested in Obsidian** (criterion 5). Follow up: manual check 6.
9. **Thumbnails and PNG export are best effort.** `html-to-image` cannot rasterise cross origin
   fonts or images it is not allowed to read; failures are swallowed and retried on the next save.
   Follow up: none for v1 unless beta users report blank thumbnails.
10. **Text in the spec but not built, by design for v1:** the `[Share soon]` placeholder in the
    top bar mock up (8.1) is not rendered; "T then click" (8.5) is the toolbar tool rather than a
    keyboard mode; tree rows in the notes panel do not repeat the folder path inline (8.6).
