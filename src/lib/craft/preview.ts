/**
 * Pure helpers for the document index. No I/O so they are easy to test.
 */

export const PREVIEW_MAX_CHARS = 600;

/**
 * Trims markdown into a short preview:
 * - drops leading YAML frontmatter (`---` ... `---`),
 * - drops a leading H1 when `title` matches it (cards already show the title),
 * - collapses runs of whitespace (newlines included) into single spaces,
 * - cuts at ~600 characters on a word boundary and appends an ellipsis.
 */
export function trimPreview(markdown: string, maxChars = PREVIEW_MAX_CHARS, title?: string): string {
  let text = markdown.replace(/\r\n?/g, "\n");
  text = stripFrontmatter(text);
  if (title) text = stripLeadingTitle(text, title);
  text = text.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  // Avoid cutting a long word in half unless the boundary is unreasonably early.
  const end = lastSpace > maxChars * 0.6 ? lastSpace : maxChars;
  return `${cut.slice(0, end).trimEnd()}…`;
}

/** Removes a leading `---\n...\n---` block, tolerating leading blank lines and BOM. */
export function stripFrontmatter(text: string): string {
  const cleaned = text.replace(/^﻿/, "");
  const match = /^\s*---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(cleaned);
  if (!match || match.index !== 0) return cleaned;
  return cleaned.slice(match[0].length);
}

function stripLeadingTitle(text: string, title: string): string {
  const match = /^\s*#[ \t]+(.+?)[ \t]*(?:\n|$)/.exec(text);
  if (!match) return text;
  if (match[1].trim().toLowerCase() === title.trim().toLowerCase()) return text.slice(match[0].length);
  return text;
}

/** First `# Heading` in the markdown, used as a title fallback. */
export function titleFromMarkdown(markdown: string): string | undefined {
  const match = /^\s*#\s+(.+?)\s*$/m.exec(stripFrontmatter(markdown));
  return match?.[1]?.trim() || undefined;
}

export type PreviewDecisionInput = {
  existing?: { preview: string | null; indexedAt: Date | null; updatedAt: Date | null; missing: boolean | null } | null;
  incomingUpdatedAt?: string;
  now?: Date;
  /** Previews older than this are refetched. Defaults to 24h. */
  maxAgeMs?: number;
};

/**
 * Decides whether a full refresh needs to fetch the preview for a document.
 * Fetch when there is no preview yet, when Craft reports a newer update, when
 * the row was marked missing, or when the preview is older than `maxAgeMs`.
 */
export function needsPreview({ existing, incomingUpdatedAt, now = new Date(), maxAgeMs = 24 * 60 * 60 * 1000 }: PreviewDecisionInput): boolean {
  if (!existing) return true;
  if (existing.missing) return true;
  if (existing.preview === null || existing.preview === undefined) return true;
  if (!existing.indexedAt) return true;
  if (incomingUpdatedAt) {
    const incoming = Date.parse(incomingUpdatedAt);
    if (!Number.isNaN(incoming)) {
      if (!existing.updatedAt || incoming > existing.updatedAt.getTime()) return true;
    }
  }
  return now.getTime() - existing.indexedAt.getTime() > maxAgeMs;
}
