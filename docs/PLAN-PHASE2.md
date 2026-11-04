# CraftCanvas phase 2: build plan

Written 2026-11-05 by Claude (orchestrator). Source: `craft-canvas-phase2-brief.md` (Barrett, 2026-11-04). Phase 1 plan: `docs/PLAN.md`.

Phase 2 adds things the tool owns itself, never written to Craft: arrows with meaning, free text, editable cards, image and PDF uploads, YouTube embeds, and a read-only MCP server so Claude or ChatGPT can search and read the canvas.

## 1. Stack additions and why

| Need | Choice | Why |
|---|---|---|
| New canvas objects, arrows | D1 tables `objects`, `arrows` (migration 0003) | Same store as boards and cards; relational queries for the MCP layer. Phase 1 `cards` stay as they are. |
| Uploads | Cloudflare R2 bucket bound to the Worker; files streamed back through `/api/assets/:id` behind the login | Next to the existing deploy, no new vendor, private by default (no public bucket URL). Limits: images 10 MB, PDFs 25 MB. |
| PDF text for citations | Extracted **in the browser** with pdf.js right after upload and posted to the API per page | The Worker never parses PDFs, so CPU limits and plan tier do not matter. The browser already needs pdf.js for the preview. Worker-side extraction can be added later for API-only uploads. |
| Search index | One index table over Craft notes, local objects and PDF pages, maintained on every write (D1 FTS5 if available, else a normalised-text table with LIKE; see research result in section 6) | The MCP `search` tool and the UI search share it. Index follows the content lifecycle: sync, object edit/delete, asset delete, note dropping out of scope. |
| YouTube | Object kind `youtube`; the Worker fetches oEmbed metadata server-side so title and author are searchable | Embed via `youtube-nocookie.com` iframe in the browser. No API key needed. |
| MCP server | `@modelcontextprotocol/sdk` 1.x `McpServer` + `WebStandardStreamableHTTPServerTransport`, stateless (new server per request, JSON responses) at `/mcp` on the same Worker | Verified to run on Workers without Durable Objects or `nodejs_compat`. One deploy, one URL, shares the D1 data. Tools follow ChatGPT's `search`/`fetch` output shapes so both clients can cite sources. |
| MCP auth for the test | Two equivalent forms, compared in constant time: `Authorization: Bearer <MCP_TOKEN>` on `/mcp`, or the unguessable path `/mcp/<MCP_TOKEN>` with no header | Claude's custom-header option is documented but in beta and may not appear in every account; ChatGPT cannot send API keys at all (OAuth or no-auth only). The path form works with both as a "no sign-in" connector. It is leak-prone (logs, screenshots): rotate with `wrangler secret put MCP_TOKEN`. OAuth stays an open decision. The password gate on the app stays. |

## 2. Ownership

| Area | Owner |
|---|---|
| Migrations, objects/arrows/assets API, R2, search index, YouTube oEmbed, MCP server, tests, deploy | Claude (`main`, via worktree) |
| Toolbar and canvas UI for text, cards, arrows (connect tool, type and label editing, endpoint re-routing), uploads (button + drag-drop, image render, PDF first-page preview and page view with pdf.js, client-side text extraction), YouTube paste and embed, visual distinction of arrows vs Craft links, search panel over the new index | Codex (`codex/frontend-phase2`, PRs against `main`) |
| Review gate, merge, deploy | Claude |
| MCP auth decision, AI client choice, upload limits | Barrett |

Contract: `docs/API.md` (phase 2 section). Codex brief: `docs/FRONTEND-PHASE2.md`.

## 3. Phases and acceptance checks

### 2.0 Objects and arrows (Claude backend, then Codex UI)
- Tables, CRUD and bulk-move endpoints for objects; arrows with type, label, colour, direction and handles; board detail returns both.
- Accept when: text placed anywhere, edited, reloaded unchanged; blank card created, edited, dragged, deleted, never in Craft; arrow created parent→child with label, endpoints re-routed, deleted without touching cards, survives reload; type and direction readable from the API; arrows look different from Craft links.

### 2.1 Uploads and YouTube
- R2 binding, `POST /api/uploads`, `GET /api/assets/:id`, PDF page text endpoint, oEmbed proxy.
- Accept when: image and PDF upload render on the canvas and survive reload; a 30 MB PDF is rejected with a clear message; a YouTube URL becomes a playing embed that survives reload.

### 2.2 Search index
- Index over notes, objects and PDF pages, updated on every write.
- Accept when: a Vietnamese note is found by keyword; editing then deleting a local card updates then removes it from results; a PDF page is found by a phrase on it with its page number.

### 2.3 MCP server
- Tools: `list_boards`, `get_board`, `search`, `fetch`, `get_pdf_pages`, `list_relationships`. Bearer token auth; 401 otherwise.
- Accept when: from Claude (any plan) the connector lists boards, searches the Vietnamese note by keyword and reads it back; one question spanning a local card, a Craft note and a PDF is answered with source links and page citations; no write tool is listed. ChatGPT: attempted after Barrett confirms their plan shows "Create MCP App".

### 2.4 Review, merge, deploy
- Same gate as phase 1: build, tests, UI click-through, independent review, no secrets in the client bundle.

## 4. Data model (migration 0003)

```
objects    id PK, board_id FK, kind ('text'|'card'|'image'|'pdf'|'youtube'), x, y, w, h, z, section_id (nullable),
           color, title, text (markdown body or caption), url (youtube), asset_id FK (nullable), meta JSON,
           created_at, updated_at
arrows     id PK, board_id FK, source_kind ('card'|'object'), source_id, target_kind, target_id,
           type ('parent_child'|'related'|'custom'), label, color, source_handle, target_handle, created_at
           direction = source → target (parent → child for parent_child)
assets     id PK, kind ('image'|'pdf'), filename, content_type, size, r2_key, width, height, page_count,
           text_status ('none'|'pending'|'done'), created_at
asset_pages asset_id FK, page, text, PK (asset_id, page)
search_index  doc_kind ('note'|'object'|'pdf_page'), doc_id, page, board_id, title, body  (+ FTS5 or normalised column)
```

Phase 1 `connections` stays for compatibility; new UI uses `arrows`.

## 5. MCP tools (read-only)

| Tool | Input | Output |
|---|---|---|
| `list_boards` | `{}` | `{boards: [{id, name, cardCount, objectCount, arrowCount, updatedAt}]}` |
| `get_board` | `{boardId}` | `{board, items: [{id, kind, title, preview, x, y, sectionId, url?}], sections, arrows: [{id, from, to, type, label, direction}], craftLinks: [{from, to}]}` |
| `search` | `{query, limit?, kinds?}` | `{results: [{id, kind, title, snippet, boardIds, page?, url}]}` (ChatGPT-compatible: also returned as `results[{id,title,text,url}]`) |
| `fetch` | `{id}` | full content of one item: note markdown with links, card/text body, PDF pages text, image/youtube metadata, plus in/out arrows and Craft links |
| `get_pdf_pages` | `{assetId, from?, to?}` | `{pages: [{page, text}], pageCount}` |
| `list_relationships` | `{boardId?, itemId?}` | `{arrows: [...], craftLinks: [...]}` |

Ids are prefixed so the client can tell kinds apart: `note:<craftId>`, `object:<id>`, `card:<id>`, `asset:<id>`, `board:<id>`.

## 6. Risks and open questions, sorted by what blocks the first spike

1. **MCP auth** (blocks the MCP acceptance check). Bearer token for Claude is implemented first; token-in-path fallback is experimental and leak-prone. OAuth is a later decision.
2. **ChatGPT plan support** (blocks the ChatGPT check only). Barrett checks whether "Create MCP App" appears in their account.
3. **R2 bucket** needs `wrangler r2 bucket create` on the account; Barrett's login already covers it.
4. **D1 FTS5 availability** decides the index implementation; the search module hides the choice. Vietnamese needs diacritics kept (no `remove_diacritics`) and prefix matching for partial words.
5. **PDF extraction in the browser** means API-only uploads have no text until the app opens the PDF; acceptable for a personal tool.
6. **Workers request body limit** caps uploads (100 MB on Workers); our limits are lower on purpose.
7. **Arrows reference two id spaces** (cards and objects); deleting either endpoint cascades the arrow in application code.

Open decisions for Barrett: MCP auth (bearer now, OAuth later?), first AI client (Claude), upload limits (10 MB / 25 MB proposed), arrows stay board-only (yes), MCP write tools (no).
