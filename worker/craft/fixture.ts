/**
 * Sample notes for development, tests and demos when no Craft connection is configured.
 * Ids look like Craft block ids. Links use the real `[text](block://id)` syntax.
 */
import type { DocRef, RawDocument } from "./parse";

export const FIXTURE_SPACE_ID = "fixture-space";

type F = { id: string; title: string; folder: [string, string] | null; created: string; modified: string; body: string };

const F_IDEAS: [string, string] = ["f-ideas", "Ideas"];
const F_PROJECTS: [string, string] = ["f-projects", "Projects"];
const F_READING: [string, string] = ["f-reading", "Reading"];

const fixtures: F[] = [
  {
    id: "n-craftcanvas",
    title: "CraftCanvas",
    folder: F_PROJECTS,
    created: "2026-10-28T09:12:00Z",
    modified: "2026-11-03T18:40:00Z",
    body: `A canvas over my Craft notes, in the style of [Heptabase](block://n-heptabase).
Cards reference notes, so one note can sit on several boards.
First version is read-only: see [Craft API notes](block://n-craft-api) and [Canvas performance](block://n-canvas-perf).
Hosting follows [Cloudflare for personal tools](block://n-cloudflare).
Open question: [Suggested relations](block://n-suggested-relations).`,
  },
  {
    id: "n-heptabase",
    title: "Heptabase model",
    folder: F_READING,
    created: "2026-10-20T14:00:00Z",
    modified: "2026-10-30T08:15:00Z",
    body: `Cards live in one library; whiteboards reference them.
Mentions create backlinks; arrows are drawn with the Connect tool.
Sections group objects; sub-whiteboards hold subtopics. Compare with [Zettelkasten](block://n-zettelkasten).
Performance notes are in [Canvas performance](block://n-canvas-perf).`,
  },
  {
    id: "n-craft-api",
    title: "Craft API notes",
    folder: F_PROJECTS,
    created: "2026-11-01T10:00:00Z",
    modified: "2026-11-04T07:30:00Z",
    body: `Endpoints: /folders, /documents, /blocks?id=, /documents/search.
Links appear as block:// in markdown. Out of scope targets show as [a private doc](invalid:out_of_scope).
Rate limits: 50 per 10 s per IP, 100 per 60 s per space. See [Rate limit strategy](block://n-rate-limits).`,
  },
  {
    id: "n-rate-limits",
    title: "Rate limit strategy",
    folder: F_PROJECTS,
    created: "2026-11-02T11:00:00Z",
    modified: "2026-11-02T11:45:00Z",
    body: `Queue requests, pace at ~1 per 700 ms, honour Retry-After, resume with a cursor.
Full import of a large space takes minutes. Part of [CraftCanvas](block://n-craftcanvas).`,
  },
  {
    id: "n-canvas-perf",
    title: "Canvas performance",
    folder: F_PROJECTS,
    created: "2026-10-29T16:20:00Z",
    modified: "2026-11-01T09:00:00Z",
    body: `Render only what is in the viewport, add a minimap, let cards fold, cap visible objects.
Heptabase reports slowdowns on dense boards ([Heptabase model](block://n-heptabase)).`,
  },
  {
    id: "n-cloudflare",
    title: "Cloudflare for personal tools",
    folder: F_IDEAS,
    created: "2026-09-12T12:00:00Z",
    modified: "2026-10-15T20:10:00Z",
    body: `Workers with static assets, D1 for relational data, secrets via wrangler.
Private repo, password gate, noindex. Used by [CraftCanvas](block://n-craftcanvas).`,
  },
  {
    id: "n-suggested-relations",
    title: "Suggested relations",
    folder: F_IDEAS,
    created: "2026-11-03T08:00:00Z",
    modified: "2026-11-03T08:30:00Z",
    body: `Embeddings over note text, dashed edges labelled "suggested", click to accept.
Cheapest option: Workers AI bge-m3 inside the same account. Related: [Zettelkasten](block://n-zettelkasten).`,
  },
  {
    id: "n-zettelkasten",
    title: "Zettelkasten",
    folder: F_READING,
    created: "2026-08-02T09:00:00Z",
    modified: "2026-08-02T09:40:00Z",
    body: `Atomic notes, explicit links, emergent structure. Luhmann's slip box.
No outgoing links here on purpose: a leaf card.`,
  },
  {
    id: "n-weekly-review",
    title: "Weekly review template",
    folder: null,
    created: "2026-07-14T07:00:00Z",
    modified: "2026-10-27T07:05:00Z",
    body: `- [ ] Clear inbox
- [ ] Review [CraftCanvas](block://n-craftcanvas) progress
- [ ] Read one item from [Reading list](block://n-reading-list)`,
  },
  {
    id: "n-reading-list",
    title: "Reading list",
    folder: F_READING,
    created: "2026-06-01T10:00:00Z",
    modified: "2026-10-31T21:00:00Z",
    body: `- [Heptabase model](block://n-heptabase)
- [Zettelkasten](block://n-zettelkasten)
- Something I have not imported yet: [draft](invalid:out_of_scope)`,
  },
  {
    id: "n-orphan",
    title: "Loose thought",
    folder: null,
    created: "2026-10-05T23:10:00Z",
    modified: "2026-10-05T23:12:00Z",
    body: `A note with no links in or out. Useful for testing search-and-add.`,
  },
  {
    id: "n-design-language",
    title: "Design language",
    folder: F_IDEAS,
    created: "2026-10-10T13:00:00Z",
    modified: "2026-11-02T15:00:00Z",
    body: `Warm neutrals, one accent, generous whitespace, cards with soft shadows.
Inspired by [Heptabase model](block://n-heptabase); applied in [CraftCanvas](block://n-craftcanvas).`,
  },
];

export function fixtureDocRefs(): DocRef[] {
  return fixtures.map((f) => ({ id: f.id, title: f.title, folderId: f.folder?.[0] ?? null, folderName: f.folder?.[1] ?? null }));
}

export function fixtureDocument(id: string): RawDocument | null {
  const f = fixtures.find((x) => x.id === id);
  if (!f) return null;
  return {
    id: f.id,
    title: f.title,
    folderId: f.folder?.[0] ?? null,
    folderName: f.folder?.[1] ?? null,
    createdAt: f.created,
    modifiedAt: f.modified,
    markdown: `<page><pageTitle>${f.title}</pageTitle><content>\n${f.body}\n</content></page>`,
    blockIds: [f.id],
    deepLinkApp: null,
  };
}
