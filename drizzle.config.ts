import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` works without a database. `migrate` and `push` need
// DATABASE_URL, which we load from .env.local (then .env) like Next.js does.
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
