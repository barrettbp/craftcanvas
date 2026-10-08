/**
 * Pure search helpers shared by the search route and the notes panel.
 */
import type { SearchResult } from "./types";

/**
 * Merges local index hits with Craft search hits. Local rows come first and
 * win on duplicates (by id); Craft rows are appended in their own order.
 */
export function mergeSearchResults(local: readonly SearchResult[], craft: readonly SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const row of local) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ ...row, source: "local" });
  }
  for (const row of craft) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ ...row, source: "craft" });
  }
  return out;
}

/** Escapes `%`, `_` and `\` so user input can be used inside an ILIKE pattern. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Normalises a query: trims, collapses whitespace, caps length. */
export function normaliseQuery(q: string | null | undefined, maxLength = 200): string {
  return (q ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
