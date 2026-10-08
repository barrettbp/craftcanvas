/**
 * Typed, lazy environment accessors.
 *
 * Nothing in this module reads `process.env` at import time. Every accessor
 * reads the variable when called, so importing a module that depends on env
 * never throws on a machine without credentials (CI, tests, `next build`).
 */

export const ENV_KEYS = [
  "DATABASE_URL",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_WEBHOOK_SECRET",
  "CRAFT_KEY_ENCRYPTION_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_THUMBNAIL_BUCKET",
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];

const HINTS: Record<EnvKey, string> = {
  DATABASE_URL:
    "Postgres connection string, e.g. postgres://user:pass@host:5432/db (Supabase: Project settings > Database > Connection string).",
  CLERK_SECRET_KEY: "Clerk secret key (sk_test_... / sk_live_...), from the Clerk dashboard > API keys.",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
    "Clerk publishable key (pk_test_... / pk_live_...), from the Clerk dashboard > API keys.",
  CLERK_WEBHOOK_SECRET: "Clerk webhook signing secret (whsec_...), from the Clerk dashboard > Webhooks.",
  CRAFT_KEY_ENCRYPTION_SECRET:
    "Random secret used to encrypt Craft API keys at rest. Generate with: openssl rand -base64 32",
  SUPABASE_URL: "Supabase project URL, e.g. https://xxxx.supabase.co (optional, thumbnails only).",
  SUPABASE_SERVICE_ROLE_KEY: "Supabase service role key (optional, thumbnails only). Never expose to the browser.",
  SUPABASE_THUMBNAIL_BUCKET: "Supabase Storage bucket name for canvas thumbnails (optional, defaults to 'thumbnails').",
};

export class MissingEnvError extends Error {
  readonly key: EnvKey;

  constructor(key: EnvKey) {
    super(`Missing environment variable ${key}. ${HINTS[key]} See .env.example.`);
    this.name = "MissingEnvError";
    this.key = key;
  }
}

function read(key: EnvKey): string | undefined {
  const value = process.env[key];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Returns the variable or throws a `MissingEnvError` with a setup hint. */
export function requireEnv(key: EnvKey): string {
  const value = read(key);
  if (value === undefined) throw new MissingEnvError(key);
  return value;
}

/** Returns the variable, or `undefined` (or `fallback`) when unset or blank. */
export function optionalEnv(key: EnvKey): string | undefined;
export function optionalEnv(key: EnvKey, fallback: string): string;
export function optionalEnv(key: EnvKey, fallback?: string): string | undefined {
  return read(key) ?? fallback;
}

/** Named accessors. Each one reads env only when invoked. */
export const env = {
  databaseUrl: () => requireEnv("DATABASE_URL"),
  clerkSecretKey: () => requireEnv("CLERK_SECRET_KEY"),
  clerkPublishableKey: () => requireEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"),
  clerkWebhookSecret: () => requireEnv("CLERK_WEBHOOK_SECRET"),
  craftKeyEncryptionSecret: () => requireEnv("CRAFT_KEY_ENCRYPTION_SECRET"),
  supabaseUrl: () => optionalEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: () => optionalEnv("SUPABASE_SERVICE_ROLE_KEY"),
  supabaseThumbnailBucket: () => optionalEnv("SUPABASE_THUMBNAIL_BUCKET", "thumbnails"),
  /** True when both Supabase values are present, so thumbnail upload can be used. */
  hasSupabase: () => optionalEnv("SUPABASE_URL") !== undefined && optionalEnv("SUPABASE_SERVICE_ROLE_KEY") !== undefined,
} as const;
