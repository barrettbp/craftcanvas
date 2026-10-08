/**
 * Database schema. Mirrors docs/FEATURE_SPEC.md section 9 exactly.
 *
 * Shared contract: later work packages extend this file, they do not rewrite it.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/** Postgres `bytea`, surfaced as a Node `Buffer`. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  /** Clerk userId */
  id: text("id").primaryKey(),
  email: text("email"),
  createdAt: timestamptz("created_at").defaultNow(),
});

export const craftConnections = pgTable(
  "craft_connections",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** https://connect.craft.do/links/XXX/api/v1 */
    baseUrl: text("base_url").notNull(),
    /** AES-256-GCM cipher text (auth tag appended). */
    apiKeyCipher: bytea("api_key_cipher").notNull(),
    apiKeyIv: bytea("api_key_iv").notNull(),
    /** For deep links, if discoverable. */
    spaceId: text("space_id"),
    label: text("label"),
    lastFullSync: timestamptz("last_full_sync"),
    /** ok | unauthorized | error */
    status: text("status").default("ok"),
    createdAt: timestamptz("created_at").defaultNow(),
  },
  (t) => [
    // One connection per user in v1.
    unique("craft_connections_user_id_unique").on(t.userId),
  ],
);

export const craftDocuments = pgTable(
  "craft_documents",
  {
    connectionId: uuid("connection_id").references(() => craftConnections.id, { onDelete: "cascade" }),
    craftDocId: text("craft_doc_id"),
    title: text("title"),
    folderId: text("folder_id"),
    folderPath: text("folder_path"),
    updatedAt: timestamptz("updated_at"),
    preview: text("preview"),
    indexedAt: timestamptz("indexed_at"),
    missing: boolean("missing").default(false),
  },
  (t) => [primaryKey({ name: "craft_documents_pkey", columns: [t.connectionId, t.craftDocId] })],
);

export const canvases = pgTable(
  "canvases",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Untitled canvas"),
    /** JSON Canvas document (see spec section 9). Typed by WP1 in src/lib/canvas/types.ts. */
    data: jsonb("data").notNull(),
    /** Optimistic concurrency. */
    version: integer("version").notNull().default(1),
    /** Storage path (or data URL when Supabase Storage is not configured). */
    thumbnail: text("thumbnail"),
    createdAt: timestamptz("created_at").defaultNow(),
    updatedAt: timestamptz("updated_at").defaultNow(),
  },
  (t) => [index("canvases_user_id_updated_at_idx").on(t.userId, t.updatedAt.desc())],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type CraftConnection = typeof craftConnections.$inferSelect;
export type NewCraftConnection = typeof craftConnections.$inferInsert;
export type CraftDocument = typeof craftDocuments.$inferSelect;
export type NewCraftDocument = typeof craftDocuments.$inferInsert;
export type Canvas = typeof canvases.$inferSelect;
export type NewCanvas = typeof canvases.$inferInsert;

/** Handy for `set: { updatedAt: now() }` style updates. */
export const now = () => sql`now()`;
