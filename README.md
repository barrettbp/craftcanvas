# CraftCanvas

A private, read-only canvas over your Craft notes, in the style of Heptabase. Notes are cards on an infinite board, existing `block://` links are drawn as arrows, and boards, card positions and sections are saved in the tool's own storage. Nothing is written to Craft.

- Plan, stack and data model: [docs/PLAN.md](docs/PLAN.md)
- API contract for the frontend: [docs/API.md](docs/API.md)

## Stack

One Cloudflare Worker serves the Vite + React SPA and a Hono API under `/api/*`. Cloudflare D1 stores the note cache and board layouts. Every path is behind a password + signed-cookie gate, and every response carries `X-Robots-Tag: noindex`.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars        # then set APP_PASSWORD and SESSION_SECRET
npm run db:migrate:local
npm run dev                           # http://localhost:5173
```

Without `CRAFT_CONNECTION_URL` in `.dev.vars` the app runs in **fixture mode** with 12 sample notes. Sign in, then `POST /api/sync` (the UI has a button for it) to fill the cache.

To read your real notes, create an API connection in Craft (Imagine tab, Connections), scope it to a few documents first, and put its URL in `.dev.vars` as `CRAFT_CONNECTION_URL`. If the connection is in API Key mode, put the `pdk_...` key in `CRAFT_API_TOKEN`. Never commit `.dev.vars`.

```bash
npm test          # vitest against the Workers runtime (D1 migrations applied automatically)
npm run typecheck
npm run build
```

## Deploy to Cloudflare

One-time, by the account owner:

```bash
npx wrangler login
```

```bash
npx wrangler d1 create craftcanvas-db
```

Copy the printed `database_id` into `wrangler.jsonc`, then:

```bash
npm run db:migrate:remote
```

```bash
npm run deploy
```

Then set the secrets (each command prompts for the value, so nothing lands in shell history):

```bash
npx wrangler secret put APP_PASSWORD
```

```bash
npx wrangler secret put SESSION_SECRET
```

```bash
npx wrangler secret put CRAFT_CONNECTION_URL
```

`CRAFT_API_TOKEN` is optional (API Key mode only). The Worker URL is printed by `wrangler deploy` as `https://craftcanvas.<account>.workers.dev`. Anonymous visitors see only the login form.

## Secrets and privacy

- The Craft connection URL and key are Worker secrets. They never reach the browser, the repo, or logs; error messages strip URLs.
- Sessions are HMAC-signed cookies (`HttpOnly`, `Secure`, `SameSite=Lax`, 14 days). Login is throttled to 5 attempts per minute per IP.
- The Worker only ever sends GET requests to Craft, paced at one request per 700 ms with `Retry-After` backoff.
