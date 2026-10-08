/**
 * "Open in Craft" (spec section 7 "Deep links"): `craftdocs://open?blockId=…`
 * with a web link fallback when the app does not answer.
 */

export const CRAFT_OPEN_FALLBACK_MS = 1500;

/** `craftdocs://open?blockId=<docId>&spaceId=<spaceId>`; `spaceId` is omitted when unknown. */
export function buildCraftDeepLink(docId: string, spaceId?: string | null): string {
  const params = new URLSearchParams({ blockId: docId });
  if (spaceId) params.set("spaceId", spaceId);
  return `craftdocs://open?${params.toString()}`;
}

export type OpenInCraftResult = "app" | "web" | "hint";

export type OpenInCraftOptions = {
  docId: string;
  spaceId?: string | null;
  webUrl?: string | null;
  /** Called when neither the app nor the web link could be opened. */
  onHint?: (hint: { webUrl?: string | null }) => void;
  /** Resolves with what finally handled the open (for tests and the toast). */
  onResult?: (result: OpenInCraftResult) => void;
  fallbackMs?: number;
};

/**
 * Tries the deep link through a hidden anchor. If the page is still visible
 * and focused after `fallbackMs` the app most likely is not installed: open
 * `webUrl` in a new tab when there is one, otherwise call `onHint`.
 */
export function openInCraft({ docId, spaceId, webUrl, onHint, onResult, fallbackMs = CRAFT_OPEN_FALLBACK_MS }: OpenInCraftOptions): void {
  if (typeof document === "undefined") return;
  const url = buildCraftDeepLink(docId, spaceId);
  let handledByApp = false;
  const markHandled = () => {
    if (document.visibilityState === "hidden" || !document.hasFocus()) handledByApp = true;
  };
  document.addEventListener("visibilitychange", markHandled);
  window.addEventListener("blur", markHandled);
  window.addEventListener("pagehide", markHandled);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } catch {
    // Some browsers throw on unknown schemes; the fallback below covers it.
  }
  anchor.remove();

  window.setTimeout(() => {
    document.removeEventListener("visibilitychange", markHandled);
    window.removeEventListener("blur", markHandled);
    window.removeEventListener("pagehide", markHandled);
    markHandled();
    if (handledByApp) {
      onResult?.("app");
      return;
    }
    if (webUrl) {
      const opened = window.open(webUrl, "_blank", "noopener,noreferrer");
      if (opened) {
        onResult?.("web");
        return;
      }
    }
    onHint?.({ webUrl });
    onResult?.("hint");
  }, fallbackMs);
}
