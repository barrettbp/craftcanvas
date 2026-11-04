# Phase 2 frontend brief (for Codex)

Branch: `codex/frontend-phase2` from `main`. Open a PR against `main`. Contract: `docs/API.md` (phase 2 section). Plan and acceptance checks: `docs/PLAN-PHASE2.md`. Keep every phase 1 rule: same-origin `/api` only, no external scripts or fonts, no raw HTML rendering, Craft notes stay read-only.

The backend ships first on `main`; until it lands, build against the types in `shared/types.ts` (phase 2 types are there once merged) and the contract.

## Features, in build order

1. **Text anywhere.** Toolbar tool "Text" (shortcut `T`): click on the canvas to place a `text` object; it edits in place immediately (plain textarea, markdown rendered when not editing, auto-grow). Save via `PATCH` on blur, debounced; position via the bulk `PUT /objects` like cards. Double-click an existing text object to edit. Delete key removes it (object only).
2. **Editable card.** Tool "Card" (`N`): places a `card` object with a title field and markdown body, same editing model. Looks like a note card but carries a "CANVAS CARD" marker instead of "CRAFT NOTE" so the two are never confused.
3. **Arrows.** Tool "Connect" (`A`), or drag from a handle on any card/object to another. Creates an `arrow` with `type: "parent_child"` by default; direction is from the dragged-from node (parent) to the drop target (child). Click an arrow to select; a small popover edits type (`parent_child` / `related` / `custom`), label and colour; `Delete` removes the arrow only. Re-route by dragging an endpoint (React Flow `reconnectable` edges) → `PATCH` with the new endpoint. Arrowhead on the target end for `parent_child`; `related` has no arrowhead. Craft links stay as in phase 1 (solid neutral, "link in Craft", not editable). Arrows must look visibly different (colour, arrowhead, label badge with the type).
4. **Uploads.** Toolbar "Upload" button and drag-and-drop onto the canvas. `POST /api/uploads` (multipart `file`; for images also `width`/`height` read from the decoded image). On success create an `image` or `pdf` object at the drop point. Show progress; show the server's `413` / `415` message plainly. Image objects render `<img src={asset.url}>` with a caption line (`text`). PDF objects render the first page with pdf.js (`pdfjs-dist` from npm, worker via Vite `?url`; no CDN), a page counter, and open a page viewer (prev/next/zoom) in the side panel on click.
5. **PDF text extraction (client side).** Right after a PDF upload, extract text per page with pdf.js (`page.getTextContent()`, join items with spaces, pages 1..n) and `PUT /api/assets/:id/text {pages, pageCount}`. Also offer "Re-extract text" on the PDF object. This is what makes PDFs searchable and lets the AI cite pages, so it must run reliably; cap at 300 pages with a message.
6. **YouTube.** Tool "Video" or paste a YouTube URL onto the canvas (paste handler): `POST /objects {kind:"youtube", url}`; render the iframe from `meta.embedUrl` with the title above it. The iframe must not capture canvas drags: wrap it so dragging happens from the card's title bar.
7. **Search panel.** Switch the "Add notes" search to `GET /api/search` so results include Craft notes, canvas cards, text and PDF pages, with the `<mark>` snippet rendered safely (only `<mark>` allowed; escape everything else). Notes still add a card; PDF-page results open the page in the viewer; object results pan to the object.

8. **Deep links from AI answers.** The MCP server cites canvas items as `https://<host>/#/board/<boardId>?focus=<cardId|objectId>` and PDF pages as `/api/assets/<id>#page=<n>`. Handle the hash route on load: open that board, pan to and select the focused card/object (ids are raw, without the `note:`/`object:` prefix). Keep the existing in-app navigation unchanged otherwise.

## Constraints

- Objects obey the same viewport culling and 180-visible cap as cards; PDF first-page rendering and YouTube iframes must be lazy (render only when visible) so dense boards stay fast.
- All object moves go through the bulk `PUT /objects` with the same debounce/queue as cards (`LayoutSaver` can take a second map).
- Sections: objects can be dropped into sections like cards (`sectionId`).
- Never render markdown as HTML (keep `react-markdown` with `skipHtml`, no `rehype-raw`), and keep `urlTransform` restricted; for text/card objects allow `https:` links to open in a new tab with `rel="noopener noreferrer"`.
- Keep the login page self-contained (CSS only).
- `npm run typecheck`, `npm run build`, `npm test` must pass; add nothing to `worker/` except styling in `login.html` if needed.

## Acceptance (what the review will click through)

Text placed, edited, reloaded unchanged. Card created, edited, dragged, deleted. Arrow drawn parent→child, label added, endpoint re-routed, deleted alone, survives reload, visibly distinct from Craft links. Image and PDF upload render and survive reload; a 30 MB PDF is refused with a clear message. YouTube URL becomes a playing embed. A phrase from a PDF page is found by search with its page number.
