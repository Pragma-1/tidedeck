export type EmbedSource = "spotify" | "youtube" | "deezer"

const ID = /^[\w-]{3,64}$/

/** Turns a normal share link into the provider's official embeddable player URL. */
export function embedUrl(source: EmbedSource, link: string, dark = true): string | null {
  const raw = link.trim()
  if (!raw) return null

  if (source === "spotify") {
    // spotify:playlist:ID
    const uri = raw.match(/^spotify:(playlist|album|track|artist|show|episode):([\w]+)$/)
    if (uri) return `https://open.spotify.com/embed/${uri[1]}/${uri[2]}${dark ? "?theme=0" : ""}`
  }

  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^www\.|^m\./, "")
  const parts = u.pathname.split("/").filter(Boolean)

  if (source === "spotify" && host === "open.spotify.com") {
    const i = parts.findIndex((p) => ["playlist", "album", "track", "artist", "show", "episode"].includes(p))
    const id = parts[i + 1]
    if (i >= 0 && id && ID.test(id)) return `https://open.spotify.com/embed/${parts[i]}/${id}${dark ? "?theme=0" : ""}`
  }

  if (source === "deezer") {
    if (host === "widget.deezer.com") return u.href
    if (host === "deezer.com") {
      const i = parts.findIndex((p) => ["playlist", "album", "track", "artist", "show", "episode"].includes(p))
      const id = parts[i + 1]
      if (i >= 0 && id && /^\d+$/.test(id)) return `https://widget.deezer.com/widget/${dark ? "dark" : "light"}/${parts[i]}/${id}`
    }
  }

  if (source === "youtube" && ["youtube.com", "music.youtube.com", "youtu.be", "youtube-nocookie.com"].includes(host)) {
    const list = u.searchParams.get("list")
    let video = u.searchParams.get("v")
    if (host === "youtu.be") video = parts[0] ?? null
    if (parts[0] === "embed" && parts[1] && parts[1] !== "videoseries") video = parts[1]
    if (list && !ID.test(list)) return null
    if (video && !ID.test(video)) return null
    if (video) return `https://www.youtube-nocookie.com/embed/${video}${list ? `?list=${list}` : ""}`
    if (list) return `https://www.youtube-nocookie.com/embed/videoseries?list=${list}`
  }

  return null
}
