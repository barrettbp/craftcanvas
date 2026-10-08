import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/lib/env";

import * as schema from "./schema";

export { schema };
export * from "./schema";

export type Db = ReturnType<typeof createDb>;

function createDb() {
  const client = postgres(env.databaseUrl(), {
    // Supabase's transaction pooler (port 6543) does not support prepared
    // statements. Disabling them works for both pooled and direct connections.
    prepare: false,
    max: 10,
  });
  return drizzle(client, { schema });
}

let cached: Db | undefined;

/**
 * Lazily creates the Drizzle client on first call and caches it for the
 * process. `DATABASE_URL` is read here, never at import time, so modules that
 * import the db are safe to load without credentials.
 */
export function getDb(): Db {
  if (!cached) cached = createDb();
  return cached;
}
