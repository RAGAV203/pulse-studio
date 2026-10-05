/** Shared (client + server) YouTube URL validation. */

export const YT_MAX_SECONDS = 6 * 60;

const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const isValidVideoId = (id: string) => ID_RE.test(id);

/** Returns the 11-char video id for any common YouTube URL form, or null. */
export function parseYouTubeId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;

  let id: string | null = null;
  if (host.endsWith("youtu.be")) {
    id = url.pathname.split("/")[1] ?? null;
  } else if (url.pathname === "/watch") {
    id = url.searchParams.get("v");
  } else {
    const m = url.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
    if (m) id = m[2];
  }
  return id && ID_RE.test(id) ? id : null;
}

export const canonicalUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export type YtInfo = {
  id: string;
  title: string;
  duration: number;
  uploader?: string;
  thumbnail?: string;
};
