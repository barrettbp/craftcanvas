export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  /** "auto" | "fixture" | "craft". auto = craft when CRAFT_CONNECTION_URL is set, else fixture. */
  CRAFT_MODE?: string;
  APP_PASSWORD?: string;
  SESSION_SECRET?: string;
  /** Secret. The Craft API connection URL (base URL). Never logged or returned. */
  CRAFT_CONNECTION_URL?: string;
  /** Secret, optional. Bearer token if the Craft connection page shows a separate credential. */
  CRAFT_API_TOKEN?: string;
};

export type AppEnv = { Bindings: Bindings };

export function craftMode(env: Bindings): "fixture" | "craft" {
  const m = (env.CRAFT_MODE ?? "auto").toLowerCase();
  if (m === "fixture") return "fixture";
  if (m === "craft") return "craft";
  return env.CRAFT_CONNECTION_URL ? "craft" : "fixture";
}
