import { createHash, randomBytes } from "node:crypto"
import { Agent, fetch as ufetch, type Response as UResponse } from "undici"
import type { MusicAccount } from "@/lib/server/secrets"

/** Minimal Subsonic / OpenSubsonic client (Navidrome, Gonic, Ampache…). */

const strict = new Agent({ connect: { timeout: 8000 } })
const lenient = new Agent({ connect: { timeout: 8000, rejectUnauthorized: false } })

export type Album = { id: string; name: string; artist: string; year?: number; coverArt?: string; songCount?: number }
export type Playlist = { id: string; name: string; songCount: number; coverArt?: string }
export type Track = { id: string; title: string; artist: string; album: string; albumId?: string; duration: number; coverArt?: string }

export class SubsonicError extends Error {}

const base = (a: MusicAccount) => a.url.trim().replace(/\/+$/, "")

function authParams(a: MusicAccount): URLSearchParams {
  const p = new URLSearchParams({ v: "1.16.1", c: "Tidedeck" })
  if (a.apiKey) {
    p.set("apiKey", a.apiKey)
  } else {
    const salt = randomBytes(8).toString("hex")
    p.set("u", a.username)
    p.set("t", createHash("md5").update(a.password + salt).digest("hex"))
    p.set("s", salt)
  }
  return p
}

export function endpointUrl(a: MusicAccount, endpoint: string, params: Record<string, string | number | undefined> = {}) {
  const p = authParams(a)
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v))
  return `${base(a)}/rest/${endpoint}?${p}`
}

export function fetchRaw(a: MusicAccount, url: string, init: { headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<UResponse> {
  return ufetch(url, { dispatcher: a.insecureTls ? lenient : strict, redirect: "follow", ...init })
}

type Json = Record<string, unknown>

async function call(a: MusicAccount, endpoint: string, params: Record<string, string | number | undefined> = {}): Promise<Json> {
  if (!/^https?:\/\//i.test(a.url)) throw new SubsonicError("Server address must start with http:// or https://")
  let res: UResponse
  try {
    res = await fetchRaw(a, endpointUrl(a, endpoint, { ...params, f: "json" }), { signal: AbortSignal.timeout(12_000) })
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } }
    throw new SubsonicError(e.name === "TimeoutError" ? "Server didn't answer in time" : `Can't reach the server (${e.cause?.code ?? e.message})`)
  }
  if (!res.ok) throw new SubsonicError(`Server answered HTTP ${res.status}`)
  const body = (await res.json().catch(() => null)) as { "subsonic-response"?: Json } | null
  const r = body?.["subsonic-response"]
  if (!r) throw new SubsonicError("That address doesn't look like a Subsonic/Navidrome server")
  if (r.status !== "ok") {
    const e = r.error as { code?: number; message?: string } | undefined
    throw new SubsonicError(e?.code === 40 ? "Wrong username or password" : e?.message ?? "Server refused the request")
  }
  return r
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v ? [v as T] : [])
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v))

const toAlbum = (x: Json): Album => ({
  id: str(x.id),
  name: str(x.name ?? x.album ?? x.title),
  artist: str(x.artist),
  year: typeof x.year === "number" ? x.year : undefined,
  coverArt: x.coverArt ? str(x.coverArt) : undefined,
  songCount: typeof x.songCount === "number" ? x.songCount : undefined,
})
const toTrack = (x: Json): Track => ({
  id: str(x.id),
  title: str(x.title),
  artist: str(x.artist),
  album: str(x.album),
  albumId: x.albumId ? str(x.albumId) : undefined,
  duration: typeof x.duration === "number" ? x.duration : 0,
  coverArt: x.coverArt ? str(x.coverArt) : undefined,
})
const toPlaylist = (x: Json): Playlist => ({
  id: str(x.id),
  name: str(x.name),
  songCount: typeof x.songCount === "number" ? x.songCount : 0,
  coverArt: x.coverArt ? str(x.coverArt) : undefined,
})

export async function ping(a: MusicAccount): Promise<string> {
  const r = await call(a, "ping")
  const type = str(r.type)
  const version = str(r.serverVersion)
  return type ? `${type[0].toUpperCase()}${type.slice(1)} ${version}`.trim() : "Subsonic server"
}

export type LibraryView = "recent" | "newest" | "frequent" | "random" | "starred" | "playlists" | "search"

export async function library(a: MusicAccount, view: LibraryView, q = "") {
  if (view === "playlists") {
    const r = await call(a, "getPlaylists")
    return { playlists: arr<Json>((r.playlists as Json)?.playlist).map(toPlaylist) }
  }
  if (view === "search") {
    const r = await call(a, "search3", { query: q, albumCount: 24, songCount: 30, artistCount: 0 })
    const res = (r.searchResult3 ?? {}) as Json
    return { albums: arr<Json>(res.album).map(toAlbum), tracks: arr<Json>(res.song).map(toTrack) }
  }
  const type = view === "starred" ? "starred" : view
  const r = await call(a, "getAlbumList2", { type, size: 36 })
  return { albums: arr<Json>((r.albumList2 as Json)?.album).map(toAlbum) }
}

export async function tracks(a: MusicAccount, by: { album?: string; playlist?: string; random?: boolean }) {
  if (by.album) {
    const r = await call(a, "getAlbum", { id: by.album })
    const album = r.album as Json
    return { title: str(album?.name), tracks: arr<Json>(album?.song).map(toTrack) }
  }
  if (by.playlist) {
    const r = await call(a, "getPlaylist", { id: by.playlist })
    const pl = r.playlist as Json
    return { title: str(pl?.name), tracks: arr<Json>(pl?.entry).map(toTrack) }
  }
  const r = await call(a, "getRandomSongs", { size: 60 })
  return { title: "Random mix", tracks: arr<Json>((r.randomSongs as Json)?.song).map(toTrack) }
}

export async function scrobble(a: MusicAccount, id: string, submission: boolean) {
  await call(a, "scrobble", { id, submission: String(submission) })
}
