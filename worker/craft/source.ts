/**
 * NoteSource hides where documents come from (bundled fixtures or the Craft API).
 */
import type { Bindings } from "../env";
import { craftMode } from "../env";
import { CraftClient } from "./client";
import { FIXTURE_SPACE_ID, fixtureDocRefs, fixtureDocument } from "./fixture";
import type { DocRef, RawDocument } from "./parse";

export type Enumeration = { spaceId: string | null; docs: DocRef[]; meta: Record<string, Record<string, unknown>> };

export interface NoteSource {
  readonly mode: "fixture" | "craft";
  enumerate(): Promise<Enumeration>;
  fetchDocument(ref: DocRef, meta?: Record<string, unknown>): Promise<RawDocument>;
}

export class FixtureSource implements NoteSource {
  readonly mode = "fixture" as const;
  async enumerate(): Promise<Enumeration> {
    return { spaceId: FIXTURE_SPACE_ID, docs: fixtureDocRefs(), meta: {} };
  }
  async fetchDocument(ref: DocRef): Promise<RawDocument> {
    const d = fixtureDocument(ref.id);
    if (!d) throw new Error(`fixture document ${ref.id} not found`);
    return d;
  }
}

export class CraftSource implements NoteSource {
  readonly mode = "craft" as const;
  constructor(private client: CraftClient) {}

  async enumerate(): Promise<Enumeration> {
    const conn = await this.client.getConnection().catch(() => ({ spaceId: null, spaceName: null }));
    const seen = new Map<string, DocRef>();
    const meta: Record<string, Record<string, unknown>> = {};

    const absorb = (items: Record<string, unknown>[], folderId: string | null, folderName: string | null) => {
      for (const it of items) {
        const ref = normalizeRef(it);
        if (!ref || seen.has(ref.id)) continue;
        seen.set(ref.id, { ...ref, folderId: ref.folderId ?? folderId, folderName: ref.folderName ?? folderName });
        meta[ref.id] = it;
      }
    };

    // Unsorted (default location) first, then every folder. A selected-documents connection may expose
    // no folders at all, in which case the default listing is everything.
    absorb(await this.client.listDocumentsRaw(), null, null);
    let folders: { id: string; name: string }[] = [];
    try {
      folders = await this.client.listFolders();
    } catch {
      folders = [];
    }
    for (const f of folders) {
      if (/^(trash|templates)$/i.test(f.id) || /^(trash|templates)$/i.test(f.name)) continue;
      try {
        absorb(await this.client.listDocumentsRaw({ folderId: f.id }), f.id, f.name);
      } catch {
        // a folder we cannot list is skipped; the rest of the space still imports
      }
    }
    return { spaceId: conn.spaceId, docs: Array.from(seen.values()), meta };
  }

  fetchDocument(ref: DocRef, meta?: Record<string, unknown>): Promise<RawDocument> {
    return this.client.getDocument(ref, meta);
  }
}

import { normalizeDocumentRef } from "./parse";
function normalizeRef(it: Record<string, unknown>): DocRef | null {
  return normalizeDocumentRef(it);
}

export function makeSource(env: Bindings, fetchImpl?: typeof fetch): NoteSource {
  if (craftMode(env) === "craft") {
    if (!env.CRAFT_CONNECTION_URL) throw new Error("CRAFT_MODE=craft but CRAFT_CONNECTION_URL is not set");
    return new CraftSource(new CraftClient({ connectionUrl: env.CRAFT_CONNECTION_URL, token: env.CRAFT_API_TOKEN, fetchImpl }));
  }
  return new FixtureSource();
}
