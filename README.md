# CraftCanvas

A thinking board for your Craft notes. Pull Craft documents onto an infinite canvas, connect them
with arrows, add text cards and groups, and keep Craft as the source of truth.

- Product spec: [`docs/FEATURE_SPEC.md`](docs/FEATURE_SPEC.md)
- Work plan: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)
- Acceptance record and known gaps: [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md)

## Stack

Next.js 16 (App Router, TypeScript, Tailwind v4, Turbopack) · React Flow (`@xyflow/react`) · Zustand ·
Clerk (Google sign in only) · Drizzle ORM on Postgres (Supabase) · Zod · Vitest.

## Run locally

```bash
pnpm install
cp .env.example .env.local      # then fill in real values (see "Setup guide")
pnpm db:migrate                 # applies drizzle/ migrations to DATABASE_URL
pnpm dev                        # http://localhost:3000
```

All checks pass without real credentials, using the placeholder values from `.env.example`:

```bash
pnpm typecheck   # next typegen && tsc --noEmit
pnpm lint        # eslint
pnpm test        # vitest run (jsdom)
pnpm build       # next build
```

Database scripts: `pnpm db:generate` (write a new migration from `src/db/schema.ts`),
`pnpm db:migrate` (apply migrations), `pnpm db:push` (sync schema directly, dev only).

## Environment variables

Copy `.env.example` to `.env.local` (git ignores `.env*` except `.env.example`). Every variable is
read lazily by `src/lib/env.ts`, so a missing value only fails at the moment it is needed and never
at import time.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | Clerk publishable key (`pk_test_...` / `pk_live_...`). Must be syntactically valid even in CI; the placeholder in `.env.example` is. |
| `CLERK_SECRET_KEY` | yes | Clerk secret key (`sk_test_...` / `sk_live_...`). |
| `CLERK_WEBHOOK_SECRET` | yes | Signing secret of the Clerk webhook endpoint (`whsec_...`). |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | yes | `/sign-in`. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | yes | `/canvases`. |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | yes | `/canvases`. |
| `DATABASE_URL` | yes | Postgres connection string. |
| `CRAFT_KEY_ENCRYPTION_SECRET` | yes | Random secret that derives the AES-256-GCM key for Craft API keys at rest. See below. |
| `SUPABASE_URL` | no | Supabase project URL, only for thumbnail storage. **Leave blank unless you fill in both Supabase values.** |
| `SUPABASE_SERVICE_ROLE_KEY` | no | Supabase service role key, server only. Leave blank with the URL. |
| `SUPABASE_THUMBNAIL_BUCKET` | no | Storage bucket for thumbnails (default `thumbnails`). |

With `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` blank, thumbnails are stored as data URLs in
the `canvases.thumbnail` column, which is fine for local work and small deployments. Any non blank
pair switches the app to Supabase Storage, so placeholder values there make every thumbnail upload
fail with `502 upload_failed`.

## Setup guide

### 1. Clerk (Google sign in only)

1. Create an application at https://dashboard.clerk.com.
2. Under **User & Authentication > Social connections** enable **Google**. Disable email,
   password, phone and every other sign in method: v1 is Google only (spec section 6).
3. Copy the **Publishable key** and **Secret key** from **API keys** into `.env.local`.
4. Under **Webhooks** add an endpoint pointing at `https://<your-host>/api/webhooks/clerk`.
   Locally, expose `pnpm dev` with `ngrok http 3000` (or the Clerk CLI) and use that URL.
   Subscribe to exactly two events: **`user.created`** and **`user.deleted`**. Copy the endpoint's
   **Signing secret** into `CLERK_WEBHOOK_SECRET`.
   - `user.created` upserts the `users` row keyed by the Clerk user id.
   - `user.deleted` deletes it; foreign keys cascade to the Craft connection, the document index
     and every canvas. The app also creates the `users` row on first use (canvas create, Craft
     connect) so a slow webhook never blocks a new user.
   - The handler verifies the svix signature and answers 400 for anything unsigned. It is the
     only public API route.
5. Routing is in `src/proxy.ts` (`clerkMiddleware`). Public routes: `/`, `/privacy`, `/sign-in`,
   `/api/webhooks/*`. Signed-out visitors to any other page are redirected to `/sign-in`;
   signed-out calls to any other `/api/*` route get `401 { "error": "unauthorized" }`. Signed-in
   visitors to `/` are sent to `/canvases`.

### 2. Supabase (Postgres) and migrations

1. Create a project at https://supabase.com and open **Project settings > Database**.
2. Put the **connection string (URI)** into `DATABASE_URL`.
   - For `pnpm db:migrate` use the **direct** connection (port 5432).
   - On Vercel the **transaction pooler** (port 6543) works too; `src/db/index.ts` disables
     prepared statements so both connection kinds behave the same.
3. Run `pnpm db:migrate`. This applies, in order:
   - `drizzle/0000_strong_imperial_guard.sql`: the four tables from spec section 9 (`users`,
     `craft_connections`, `craft_documents`, `canvases`) plus the `(user_id, updated_at desc)`
     index on canvases.
   - `drizzle/0001_rls.sql`: enables **row level security** on all four tables with policies that
     compare the row's owner to the JWT `sub` claim (`craft_documents` joins through its
     connection). The app connects as the table owner, which **bypasses RLS**, and every query
     already filters by `user_id` in SQL; RLS is a second layer so any other client with a user
     JWT (PostgREST, a dashboard, a future edge function) can only reach its own rows. Tables are
     not `FORCE`d, so migrations and the app keep full access.
4. Schema changes: edit `src/db/schema.ts`, run `pnpm db:generate` to write a migration, then
   `pnpm db:migrate`. `0001_rls.sql` was written by hand because it changes policies, not columns.

### 3. Thumbnails (Supabase Storage, optional)

1. In the Supabase dashboard open **Storage** and create a bucket named `thumbnails` (or set
   `SUPABASE_THUMBNAIL_BUCKET` to whatever you call it).
2. The bucket **must allow public read**: the canvas list renders thumbnails with a plain
   `<img src>` pointing at the bucket's public URL (`/storage/v1/object/public/<bucket>/...`).
   Tick "Public bucket" when creating it, or add a `SELECT` policy for `anon`. Writes go through
   the service role key on the server, so no insert policy is needed.
3. Set `SUPABASE_URL` (**Project settings > API > Project URL**) and `SUPABASE_SERVICE_ROLE_KEY`
   (**Project settings > API > service_role**). Never expose the service role key to the browser;
   it is only read inside `src/lib/export/thumbnail-upload.ts`.
4. Thumbnails are rendered in the browser after a successful save, at most once per 30 seconds per
   canvas, and stored at `<userId>/<canvasId>.png`.

### 4. Craft key encryption secret

Craft API keys are encrypted at rest with AES-256-GCM. The 32 byte key is the SHA-256 of
`CRAFT_KEY_ENCRYPTION_SECRET` (`src/lib/crypto/aes.ts`). Generate a strong value once and keep it
stable; rotating it makes every stored key undecryptable (users would have to reconnect):

```bash
openssl rand -base64 32
```

Put the output in `CRAFT_KEY_ENCRYPTION_SECRET`. The app refuses to start a Craft request without
it (`500 server_misconfigured`).

### 5. Craft (done by each user, not by the operator)

CraftCanvas talks to Craft through a per user **API connection** that the user creates inside
Craft:

1. In Craft open **Connections > New API Connection**, choose which documents it can see
   ("All documents" gives the best experience; a "Selected documents" connection works but only
   shows those), and switch it to **API Key** mode.
2. Craft shows a connection URL like `https://connect.craft.do/links/XXXX/api/v1` and a key
   starting with `pdk_`.
3. Paste both into **Settings > Connect Craft** (`/settings/craft`). "Test connection" calls
   `GET /folders` through the server; "Save and index" stores the key encrypted and starts the
   first index. The key never reaches the browser again and never appears in a log
   (`src/lib/log.ts` redacts anything shaped like `pdk_…`).

Only `https://` URLs on `craft.do` hosts are accepted, so the server side proxy cannot be pointed
at arbitrary hosts.

### 6. Deploy to Vercel

1. Import the repository in Vercel. Framework preset: Next.js. Build command `pnpm build`,
   install command `pnpm install` (the repo pins `pnpm@10` in `package.json`).
2. Add every variable from the table above as **Environment Variables** for Production (and
   Preview if you use preview deployments; Clerk needs a separate development instance and keys
   for preview URLs). Use the Supabase **transaction pooler** URL for `DATABASE_URL`.
3. Run `pnpm db:migrate` from your machine against the production database before the first
   deploy (Vercel's build does not run migrations).
4. Point the Clerk webhook at `https://<your-vercel-domain>/api/webhooks/clerk` and set
   `CLERK_WEBHOOK_SECRET` to that endpoint's signing secret.
5. Route handlers run on the Node.js runtime (they use `node:crypto` and `postgres`); nothing is
   configured for the Edge runtime, and `src/proxy.ts` only does Clerk session checks.
6. **Rate limiter caveat.** `src/lib/rate-limit` keeps a per user sliding window (120/min for
   `/api/canvases/*`, 60/min for `/api/craft/*`) **in process memory**. Vercel runs several
   function instances, and each one counts separately, so the effective ceiling is
   `limit × instances`. The full refresh "once per minute" rule is stored in the database and is
   not affected. Move the window to Upstash Redis (or similar) when the app runs on more than one
   instance and the limit needs to be exact. Over the limit the routes answer `429` with
   `Retry-After` and `{ "error": "rate_limited", "retryAfter" }`.

## Architecture

```
Browser (Next.js client, React Flow, Zustand store, autosave, thumbnail capture)
   |  fetch / server action
Next.js server (Vercel, Node runtime)
   |-- src/proxy.ts                 Clerk middleware: public routes, 401 for API, redirect for pages
   |-- /api/canvases/*              CRUD, autosave with version check, duplicate, export, thumbnail
   |-- /api/craft/connect           test + store the encrypted key, disconnect
   |-- /api/craft/folders           proxy
   |-- /api/craft/documents         proxy + index update, local fallback
   |-- /api/craft/search            local index first, merged with Craft search
   |-- /api/craft/preview/:docId    fetch markdown, update index, trimmed response
   |-- /api/craft/refresh, status   background full refresh, connection status
   |-- /api/webhooks/clerk          user.created / user.deleted (svix verified)
   |
Postgres (Supabase, Drizzle)  +  Supabase Storage (thumbnails, optional)
   |
Craft Connect API (connect.craft.do), called only from the server with the decrypted key
```

Where things live:

```
src/app/                      App Router pages and route handlers
src/components/canvas/        React Flow canvas, nodes, edges, toolbar, context menus, export menu
src/components/notes-panel/   Folder tree, search, drag source (talks only to /api/craft/*)
src/components/canvas-list/   /canvases grid
src/components/settings/      Connect form, connection card, account deletion
src/components/ui/            Toasts, empty states
src/store/                    Zustand stores (canvas document + history, ephemeral UI state)
src/hooks/                    Autosave, thumbnails, Craft previews, keyboard shortcuts
src/lib/canvas/               JSON Canvas types, zod schema, React Flow conversion, autosave controller
src/lib/craft/                Craft client (retry, timeout), response normalisation, indexer, connection loader
src/lib/crypto/               AES-256-GCM for the Craft key
src/lib/export/               .canvas and PNG export, thumbnail capture and storage
src/lib/rate-limit/           Per user in memory rate limit
src/lib/log.ts                Structured logger that redacts pdk_ keys
src/db/                       Drizzle schema and lazy getDb()
drizzle/                      SQL migrations (tables, RLS)
docs/                         Feature spec, implementation plan, acceptance record
```

The spec is the source of truth for behaviour (`docs/FEATURE_SPEC.md`); the plan describes how the
work was split and the shared contracts between packages (`docs/IMPLEMENTATION_PLAN.md`); the
acceptance record walks every criterion and lists known gaps (`docs/ACCEPTANCE.md`).

## Security summary

- The `pdk_` key is decrypted only inside `src/lib/craft/connection.ts` and handed to the Craft
  client closure. No route returns it, no client component sees it, and the logger redacts it.
- Every API route and server action checks Clerk `auth()`; every query is scoped by `user_id`.
  Another user's canvas id is a 404, signed out is a 401.
- The Clerk webhook verifies svix signatures. Connect URLs are restricted to `craft.do`.
- RLS is enabled as a second layer (see migrations). Routes are rate limited per user.
- `/privacy` states exactly what is stored and for how long.

## Open questions (spec section 14) and where the code stands

| # | Question | State in the code |
| --- | --- | --- |
| 1 | Does Craft offer third party OAuth for apps yet? | Not used. The connect step takes a pasted connection URL and `pdk_` key (`/settings/craft`, `POST /api/craft/connect`). Swapping in OAuth would replace `CraftConnectForm` and the connect route; the client, indexer and routes only need a bearer token. Needs a check against the Craft developer docs. |
| 2 | Can we discover `spaceId` for deep links, or do we ask the user to paste a Craft link? | **Not discovered reliably.** `src/lib/craft/normalise.ts` `extractSpaceId` looks for `spaceId` / `space_id` / `space.id` in the `/folders` payload and stores it on the connection when found. When absent, the deep link is `craftdocs://open?blockId=<docId>` with `spaceId` omitted, and "Open in Craft" falls back to the document's web link (when the API provides one) or a hint. Decide after seeing a real response; a "paste any Craft link" field is the fallback plan. |
| 3 | Allow a connection with "Selected documents" scope? | Allowed. The connect page recommends "All documents", explains the limitation, and the notes panel shows a "Check the connection scope" hint when a connection lists no documents. |
| 4 | Is a 600 character preview enough? | 600 characters, trimmed at a word boundary (`src/lib/craft/preview.ts`). Full note bodies are never stored. Revisit after beta feedback. |
| 5 | Thumbnails in the browser or server side with Playwright? | Browser. `html-to-image` renders the React Flow viewport after a save, throttled to once per 30 seconds, and posts a PNG (max 400 KB) to `/api/canvases/:id/thumbnail`. |
| 6 | Multi connection support? | Not in v1. The schema has `unique (user_id)` on `craft_connections` (one connection per user) and every Craft route loads "the" connection for the user. Lifting the constraint is cheap at the schema level, but the routes, the notes panel and `connectionId` on file nodes would need a connection parameter. |
