import type { YouTubeMeta } from "../shared/types";

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Accepts watch, youtu.be, shorts, embed and live URLs. Returns the 11-char video id or null. */
export function parseYouTubeId(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
      if (m) id = m[2];
    }
  }
  return id && ID_RE.test(id) ? id : null;
}

export async function youtubeMeta(input: string, fetchImpl: typeof fetch = (i, o) => globalThis.fetch(i, o)): Promise<YouTubeMeta | null> {
  const videoId = parseYouTubeId(input);
  if (!videoId) return null;
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const meta: YouTubeMeta = { videoId, url, embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`, title: null, author: null, thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
  try {
    const res = await fetchImpl(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const j = (await res.json()) as Record<string, unknown>;
      if (typeof j.title === "string") meta.title = j.title;
      if (typeof j.author_name === "string") meta.author = j.author_name;
      if (typeof j.thumbnail_url === "string") meta.thumbnailUrl = j.thumbnail_url;
    } else {
      await res.body?.cancel();
    }
  } catch {
    // metadata is optional; the embed still works
  }
  return meta;
}
