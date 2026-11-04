/**
 * Pure helpers for turning Craft output into cache rows. No network, no bindings.
 */

export type ParsedLink = { targetBlockId: string; label: string; outOfScope: boolean };

const LINK_RE = /\[([^\]]*)\]\((block:\/\/([A-Za-z0-9_-]+)|invalid:out_of_scope)\)/g;

/** Extract `[text](block://id)` cross-references and `invalid:out_of_scope` targets from markdown. */
export function extractLinks(markdown: string): ParsedLink[] {
  const out: ParsedLink[] = [];
  const seen = new Set<string>();
  let oos = 0;
  for (const m of markdown.matchAll(LINK_RE)) {
    const label = m[1].trim();
    if (m[3]) {
      if (seen.has(m[3])) continue;
      seen.add(m[3]);
      out.push({ targetBlockId: m[3], label, outOfScope: false });
    } else {
      // Keep one row per out-of-scope mention so the UI can say "n links lead outside the connection".
      oos += 1;
      out.push({ targetBlockId: `out_of_scope:${oos}`, label, outOfScope: true });
    }
  }
  return out;
}

/** Strip Craft's markdown wrapper tags (<page>, <pageTitle>, <content>, <card>, <callout>...) to plain markdown. */
export function cleanMarkdown(markdown: string): string {
  return markdown
    .replace(/<\/?(page|content|card|callout|caption|collection|collectionItem|contentPreview|itemsPreview)(\s[^>]*)?>/g, "")
    .replace(/<pageTitle>([\s\S]*?)<\/pageTitle>/g, "# $1\n")
    .replace(/<property name="([^"]*)">([\s\S]*?)<\/property>/g, "**$1:** $2")
    .replace(/<highlight(\s[^>]*)?>([\s\S]*?)<\/highlight>/g, "==$2==")
    .replace(/<comment id="[^"]*">[\s\S]*?<\/comment>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** First non-title text, links turned to their labels, cut to `max` characters. */
export function makePreview(markdown: string, max = 280): string {
  const body = cleanMarkdown(markdown)
    .split("\n")
    .filter((l) => !/^#\s/.test(l))
    .join(" ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#=]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return body.length > max ? body.slice(0, max - 1).trimEnd() + "…" : body;
}

/** Title from a <pageTitle> tag, else the first markdown heading, else the first line. */
export function titleFromMarkdown(markdown: string): string | null {
  const tag = markdown.match(/<pageTitle>([\s\S]*?)<\/pageTitle>/);
  if (tag) return tag[1].trim() || null;
  const heading = markdown.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim() || null;
  const first = markdown.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("<"));
  return first ? first.slice(0, 120) : null;
}

export type DocRef = { id: string; title: string; folderId: string | null; folderName: string | null };

export type RawDocument = {
  id: string;
  title: string;
  folderId: string | null;
  folderName: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  markdown: string;
  /** Every block id in the document (including the root). Used to resolve links to sub-blocks. */
  blockIds: string[];
  deepLinkApp: string | null;
};

export function deepLinks(spaceId: string | null, documentId: string, clickable?: string | null) {
  const app = clickable && clickable.startsWith("craftdocs://") ? clickable : spaceId ? `craftdocs://open?spaceId=${encodeURIComponent(spaceId)}&documentId=${encodeURIComponent(documentId)}` : "";
  const web = spaceId ? `https://docs.craft.do/editor/d/${encodeURIComponent(spaceId)}/${encodeURIComponent(documentId)}` : "";
  return { app, web };
}

// ---------- Defensive normalisers for Craft JSON (field names are not published in full) ----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function pickString(o: Obj, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

/** Craft titles can be a string or an object such as {text: "..."} / {markdown: "..."}. */
export function normalizeTitle(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (isObj(v)) {
    const s = pickString(v, ["text", "markdown", "plain", "value", "title"]);
    if (s) return s.trim();
    if (Array.isArray(v.content)) return v.content.map(normalizeTitle).join("").trim();
  }
  if (Array.isArray(v)) return v.map(normalizeTitle).join("").trim();
  return "";
}

export function normalizeDocumentRef(item: unknown): DocRef | null {
  if (!isObj(item)) return null;
  const id =
    pickString(item, ["id", "documentId", "rootBlockId", "blockId"]) ??
    (Array.isArray(item.rootBlockIds) && typeof item.rootBlockIds[0] === "string" ? item.rootBlockIds[0] : null);
  if (!id) return null;
  const deleted = item.deleted === true || item.isDeleted === true || item.deletionStatus === "deleted";
  if (deleted) return null;
  const folder = isObj(item.folder) ? item.folder : null;
  return {
    id,
    title: normalizeTitle(item.title ?? item.name) || "Untitled",
    folderId: pickString(item, ["folderId"]) ?? (folder ? pickString(folder, ["id"]) : null),
    folderName: pickString(item, ["folderName"]) ?? (folder ? pickString(folder, ["name"]) : null),
  };
}

export type FolderRef = { id: string; name: string; parentId: string | null };

export function flattenFolders(items: unknown, parentId: string | null = null, out: FolderRef[] = []): FolderRef[] {
  if (!Array.isArray(items)) return out;
  for (const it of items) {
    if (!isObj(it)) continue;
    const id = pickString(it, ["id", "folderId"]);
    const name = pickString(it, ["name", "title"]) ?? "";
    if (id) out.push({ id, name, parentId });
    const children = it.subfolders ?? it.children ?? it.folders ?? it.items;
    if (Array.isArray(children)) flattenFolders(children, id, out);
  }
  return out;
}

/**
 * Walk a Craft block tree (JSON) and produce markdown plus every block id.
 * Works for a root page block ({title, content:[...]}) or a wrapper {blocks:[...]} / {items:[...]}.
 */
export function blocksToMarkdown(root: unknown): { markdown: string; blockIds: string[]; title: string | null } {
  const lines: string[] = [];
  const ids: string[] = [];
  let title: string | null = null;

  const visit = (b: unknown, depth: number) => {
    if (Array.isArray(b)) {
      for (const x of b) visit(x, depth);
      return;
    }
    if (!isObj(b)) return;
    const id = pickString(b, ["id", "blockId"]);
    if (id) ids.push(id);
    const type = pickString(b, ["type"]);
    if (type === "page" || (depth === 0 && b.title !== undefined)) {
      // Craft's JSON puts a page's title in `markdown` (verified 2026-11-04); older docs mention `title`.
      const t = normalizeTitle(b.title) || (pickString(b, ["markdown"]) ?? "").trim();
      if (t) {
        if (title === null && depth === 0) title = t;
        lines.push(`${"#".repeat(Math.min(6, depth + 1))} ${t}`);
      }
    } else {
      const md = pickString(b, ["markdown", "text"]);
      if (md) {
        const indent = typeof b.indentationLevel === "number" ? b.indentationLevel : 0;
        const style = pickString(b, ["listStyle"]);
        const prefix = style === "bullet" ? "- " : style === "numbered" ? "1. " : style === "task" ? "- [ ] " : style === "toggle" ? "- " : "";
        lines.push(`${"  ".repeat(Math.max(0, indent))}${prefix}${md}`);
      }
    }
    const children = b.content ?? b.children ?? b.blocks ?? b.items;
    if (Array.isArray(children)) visit(children, depth + 1);
  };

  visit(root, 0);
  return { markdown: lines.join("\n").trim(), blockIds: Array.from(new Set(ids)), title };
}
