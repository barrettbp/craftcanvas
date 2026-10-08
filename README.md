# CraftCanvas

A thinking board for your Craft notes. Pull Craft documents onto an infinite canvas, connect them
with arrows, add text cards and groups, and keep Craft as the source of truth.

Product spec: [`docs/FEATURE_SPEC.md`](docs/FEATURE_SPEC.md). Work plan:
[`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

## Stack

Next.js 16 (App Router, TypeScript, Tailwind v4, Turbopack) · React Flow (`@xyflow/react`) · Zustand ·
Clerk (Google sign in) · Drizzle ORM on Postgres (Supabase) · Zod · Vitest.

## Run locally

```bash
pnpm install
cp .env.example .env.local      # then fill in real values (see below)
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
read lazily by `src/lib/env.ts`, so missing values only fail at the moment they are needed.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | Clerk publishable key (`pk_test_...`). Must be syntactically valid even in CI; the placeholder in `.env.example` is. |
| `CLERK_SECRET_KEY` | yes | Clerk secret key (`sk_test_...`). |
| `CLERK_WEBHOOK_SECRET` | yes | Signing secret of the Clerk webhook endpoint (`whsec_...`). |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | yes | `/sign-in`. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | yes | `/canvases`. |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | yes | `/canvases`. |
| `DATABASE_URL` | yes | Postgres connection string. |
| `CRAFT_KEY_ENCRYPTION_SECRET` | yes | Random secret that derives the AES-256-GCM key for Craft API keys at rest. `openssl rand -base64 32`. |
| `SUPABASE_URL` | no | Supabase project URL, for thumbnail storage. |
| `SUPABASE_SERVICE_ROLE_KEY` | no | Supabase service role key, server only. |
| `SUPABASE_THUMBNAIL_BUCKET` | no | Storage bucket for thumbnails (default `thumbnails`). |

## Set up Clerk (Google sign in)

1. Create an application at https://dashboard.clerk.com. Under **User & Authentication > Social
   connections** enable **Google** and disable email, password and every other method (v1 is Google
   only).
2. Copy the publishable and secret keys from **API keys** into `.env.local`.
3. Under **Webhooks** add an endpoint pointing at `https://<your-host>/api/webhooks/clerk`
   (use `ngrok` or the Clerk CLI locally), subscribe to `user.created` and `user.deleted`, and copy
   the signing secret into `CLERK_WEBHOOK_SECRET`. The handler creates and removes the `users` row;
   foreign keys cascade to connections, the document index and canvases.
4. Routing: `src/proxy.ts` runs `clerkMiddleware`. Public routes are `/`, `/privacy`, `/sign-in`
   and `/api/webhooks/*`; everything else requires a session. Signed-in visitors to `/` are sent to
   `/canvases`.

## Set up Supabase (Postgres)

1. Create a project at https://supabase.com and open **Project settings > Database**.
2. Put the connection string into `DATABASE_URL`. Use the direct connection for `pnpm db:migrate`;
   on Vercel the transaction pooler (port 6543) is fine, the Drizzle client disables prepared
   statements for it.
3. Run `pnpm db:migrate`. The schema (`src/db/schema.ts`) has four tables: `users`,
   `craft_connections`, `craft_documents`, `canvases`, matching spec section 9.
4. For thumbnails, create a public Storage bucket (default name `thumbnails`) and set the three
   `SUPABASE_*` variables. Without them thumbnails are stored as data URLs in the database.

## Database

Migrations live in `drizzle/` and are applied with `pnpm db:migrate` (`drizzle-kit migrate`, which
reads `drizzle/meta/_journal.json`). Schema changes are generated from `src/db/schema.ts` with
`pnpm db:generate`; `0001_rls.sql` was written by hand because it changes policies, not columns.

- `0000_strong_imperial_guard.sql`: the four tables from spec section 9.
- `0001_rls.sql`: enables **row level security** on `users`, `craft_connections`, `craft_documents`
  and `canvases` with policies that compare the row's owner against the JWT `sub` claim
  (`coalesce(current_setting('request.jwt.claims', true)::json->>'sub', '')`; `craft_documents`
  joins through its connection). The app itself connects with the **service role / table owner,
  which bypasses RLS**, and every query already filters by `user_id`; RLS is a second layer so any
  other client with a user JWT (PostgREST, dashboards, future edge functions) can only reach its
  own rows. Tables are not `FORCE`d, so the owner keeps full access for the app and for migrations.

Our own API routes are also rate limited per user (`src/lib/rate-limit`, 120/min for
`/api/canvases/*`, 60/min for `/api/craft/*`, in memory and therefore per instance in v1); over the
limit they answer `429` with `Retry-After` and `{ "error": "rate_limited", "retryAfter" }`.

## Set up Craft

CraftCanvas talks to Craft through a per-user **API connection** that the user creates inside Craft:

1. In Craft open **Connections > New API Connection**, choose which documents it can see
   ("All documents" gives the best experience), and switch it to **API Key** mode.
2. Craft shows a connection URL like `https://connect.craft.do/links/XXXX/api/v1` and a key starting
   with `pdk_`.
3. Paste both into **Settings > Connect Craft** (`/settings/craft`) in CraftCanvas. The key is
   encrypted with `CRAFT_KEY_ENCRYPTION_SECRET` before it is stored and never reaches the browser.

## Project layout

```
src/app/                 App Router pages and route handlers
  api/webhooks/clerk/    Clerk webhook (svix verified)
  sign-in/[[...sign-in]] Clerk hosted sign in
  canvases, canvas/[id], settings, settings/craft, privacy
src/components/app-shell TopBar with Clerk UserButton
src/db/                  Drizzle schema and lazy getDb()
src/lib/env.ts           Typed, lazy env accessors
src/proxy.ts             Clerk middleware (Next 16 "proxy" convention)
drizzle/                 Generated SQL migrations
```
