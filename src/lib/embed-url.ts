/** Shared by the server renderer and the browser: classifies a media URL. Pure, no I/O. */
export type Embed =
  | { kind: "video"; src: string }
  | { kind: "youtube"; id: string; href: string }
  | { kind: "vimeo"; id: string; href: string }
  | { kind: "link"; href: string; host: string };

export const MEDIA_PATH = /^\/media\/[A-Za-z0-9_-]{16,40}\.(?:png|jpe?g|gif|webp|mp4|webm|ogv|mov)$/;
export const VIDEO_EXT = /\.(?:mp4|webm|ogv|ogg|m4v|mov)$/i;
export const YT_ID = /^[A-Za-z0-9_-]{11}$/;
export const VIMEO_ID = /^\d{1,12}$/;

/** Absolute http(s) URL or one of our own /media/ files; everything else is rejected. */
export function safeUrl(raw: string): URL | null {
  if (MEDIA_PATH.test(raw)) return new URL(raw, "https://local.invalid");
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}
export const isLocal = (u: URL) => u.host === "local.invalid";

export function classify(raw: string): Embed | null {
  const u = safeUrl(raw.trim());
  if (!u) return null;
  if (isLocal(u)) return VIDEO_EXT.test(u.pathname) ? { kind: "video", src: u.pathname } : null;
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = u.searchParams.get("v") ?? /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(u.pathname)?.[1] ?? null;
  }
  if (id && YT_ID.test(id)) return { kind: "youtube", id, href: `https://www.youtube.com/watch?v=${id}` };
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const v = /^\/(?:video\/)?(\d{1,12})(?:\/|$)/.exec(u.pathname)?.[1];
    if (v && VIMEO_ID.test(v)) return { kind: "vimeo", id: v, href: `https://vimeo.com/${v}` };
  }
  if (VIDEO_EXT.test(u.pathname) && u.protocol === "https:") return { kind: "video", src: u.href };
  return { kind: "link", href: u.href, host: u.hostname };
}
