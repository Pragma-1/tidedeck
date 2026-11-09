"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import {
  ArrowLeft,
  Disc3,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react"
import { Slider } from "@/components/ui/slider"
import { coverUrl, currentTrack, formatTime, player, usePlayer, type Track } from "@/hooks/use-player"
import { embedUrl } from "@/lib/music-embed"
import type { BlockOf } from "@/lib/schema"
import { cn } from "@/lib/utils"

export function MusicWidget({ block, editing }: { block: BlockOf<"music">; editing: boolean }) {
  if (block.props.source === "navidrome") return <NavidromePlayer block={block} editing={editing} />
  return <EmbedPlayer block={block} editing={editing} />
}

// --- Spotify / YouTube / Deezer --------------------------------------------

function EmbedPlayer({ block, editing }: { block: BlockOf<"music">; editing: boolean }) {
  const { resolvedTheme } = useTheme()
  const source = block.props.source as "spotify" | "youtube" | "deezer"
  const src = embedUrl(source, block.props.link, resolvedTheme !== "light")
  if (!src) {
    return (
      <p className="px-4 pb-4 text-sm text-muted-foreground">
        {editing ? "Paste a playlist, album or track link in this block's settings." : "No music link set."}
      </p>
    )
  }
  return (
    <iframe
      key={src}
      src={src}
      title={block.title || "Music player"}
      loading="lazy"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      referrerPolicy="strict-origin-when-cross-origin"
      className="h-full w-full border-0"
    />
  )
}

// --- Navidrome / Subsonic ---------------------------------------------------

type Album = { id: string; name: string; artist: string; year?: number; coverArt?: string }
type Playlist = { id: string; name: string; songCount: number; coverArt?: string }
type LibraryData = { albums?: Album[]; playlists?: Playlist[]; tracks?: Track[] }
type View = "recent" | "newest" | "random" | "playlists" | "search"
type Detail = { kind: "album" | "playlist" | "random"; id?: string; title: string }

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "recent", label: "Recent" },
  { id: "newest", label: "New" },
  { id: "random", label: "Discover" },
  { id: "playlists", label: "Playlists" },
]

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { status: res.status })
  return body as T
}

function Cover({ blockId, id, size, className }: { blockId: string; id?: string; size: number; className?: string }) {
  const src = coverUrl(blockId, id, size)
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return (
    <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-md bg-muted", className)}>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        <Disc3 className="size-1/2 text-muted-foreground" aria-hidden />
      )}
    </span>
  )
}

function NavidromePlayer({ block, editing }: { block: BlockOf<"music">; editing: boolean }) {
  const [view, setView] = useState<View>("recent")
  const [query, setQuery] = useState("")
  const [submitted, setSubmitted] = useState("")
  const [data, setData] = useState<LibraryData | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailTracks, setDetailTracks] = useState<Track[] | null>(null)
  const [error, setError] = useState<{ status?: number; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const base = `/api/music`
  const b = encodeURIComponent(block.id)

  useEffect(() => {
    if (view === "search" && !submitted) return
    let cancelled = false
    setBusy(true)
    getJson<LibraryData>(`${base}/library?block=${b}&view=${view}&q=${encodeURIComponent(submitted)}`)
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((e: Error & { status?: number }) => !cancelled && setError({ status: e.status, message: e.message }))
      .finally(() => !cancelled && setBusy(false))
    return () => {
      cancelled = true
    }
  }, [view, submitted, b, base])

  useEffect(() => {
    if (!detail) return setDetailTracks(null)
    let cancelled = false
    setDetailTracks(null)
    const by = detail.kind === "album" ? `album=${detail.id}` : detail.kind === "playlist" ? `playlist=${detail.id}` : "random=1"
    getJson<{ tracks: Track[] }>(`${base}/tracks?block=${b}&${by}`)
      .then((d) => !cancelled && setDetailTracks(d.tracks))
      .catch((e: Error) => !cancelled && setError({ message: e.message }))
    return () => {
      cancelled = true
    }
  }, [detail, b, base])

  if (error?.status === 409) {
    return <p className="px-4 pb-4 text-sm text-muted-foreground">{editing ? "Open this block's settings to connect your Navidrome server." : "This player isn't connected yet."}</p>
  }
  if (error?.status === 401) {
    return <p className="px-4 pb-4 text-sm text-muted-foreground">Sign in to play music here.</p>
  }

  const shuffleAll = async () => {
    try {
      const d = await getJson<{ tracks: Track[] }>(`${base}/tracks?block=${b}&random=1`)
      player.playTracks(block.id, d.tracks, 0, "Random mix", true)
    } catch (e) {
      setError({ message: (e as Error).message })
    }
  }

  return (
    <div className="music-root flex h-full flex-col">
      <NowPlaying blockId={block.id} onShuffleAll={shuffleAll} />

      <div className="music-library min-h-0 flex-1 flex-col border-t">
        <div className="flex items-center gap-1 px-3 pt-2.5 pb-2">
          {detail ? (
            <button type="button" onClick={() => setDetail(null)} className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm hover:bg-accent">
              <ArrowLeft className="size-4 shrink-0" />
              <span className="truncate font-medium">{detail.title}</span>
            </button>
          ) : (
            <>
              <div className="flex min-w-0 gap-0.5 overflow-x-auto" role="tablist" aria-label="Library">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    role="tab"
                    aria-selected={view === v.id}
                    onClick={() => setView(v.id)}
                    className={cn(
                      "shrink-0 rounded-md px-2 py-1 text-xs transition-colors",
                      view === v.id ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              <form
                className="ml-auto flex min-w-0 items-center gap-1 rounded-md bg-muted/70 px-2 focus-within:ring-2 focus-within:ring-ring/40"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!query.trim()) return
                  setSubmitted(query.trim())
                  setView("search")
                }}
              >
                <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search"
                  aria-label="Search your music"
                  className="h-7 w-20 min-w-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground @[22rem]:w-32"
                />
              </form>
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {error && !error.status && <p className="py-2 text-sm text-destructive">{error.message}</p>}
          {detail ? (
            <TrackList blockId={block.id} tracks={detailTracks} title={detail.title} />
          ) : busy && !data ? (
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-md bg-muted/60" />
              ))}
            </div>
          ) : (
            <LibraryContent
              blockId={block.id}
              data={data}
              view={view}
              onOpen={(d) => setDetail(d)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function LibraryContent({
  blockId,
  data,
  view,
  onOpen,
}: {
  blockId: string
  data: LibraryData | null
  view: View
  onOpen: (d: Detail) => void
}) {
  if (!data) return null
  if (view === "playlists") {
    if (!data.playlists?.length) return <p className="py-2 text-sm text-muted-foreground">No playlists on the server.</p>
    return (
      <ul className="grid gap-0.5">
        {data.playlists.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onOpen({ kind: "playlist", id: p.id, title: p.name })}
              className="flex w-full items-center gap-3 rounded-md p-1.5 text-left hover:bg-accent/70"
            >
              <Cover blockId={blockId} id={p.coverArt} size={96} className="size-9" />
              <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{p.songCount}</span>
            </button>
          </li>
        ))}
      </ul>
    )
  }
  const albums = data.albums ?? []
  return (
    <div className="grid gap-4">
      {view === "search" && data.tracks && data.tracks.length > 0 && <TrackList blockId={blockId} tracks={data.tracks} title="Search results" compact />}
      {albums.length === 0 && !(data.tracks && data.tracks.length) && (
        <p className="py-2 text-sm text-muted-foreground">{view === "search" ? "Nothing found." : "No albums yet."}</p>
      )}
      {albums.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.25rem,1fr))] gap-x-3 gap-y-3.5">
          {albums.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onOpen({ kind: "album", id: a.id, title: a.name })} className="group/al w-full text-left">
                <span className="relative block">
                  <Cover blockId={blockId} id={a.coverArt} size={300} className="aspect-square w-full" />
                  <span className="absolute inset-0 rounded-md ring-1 ring-black/5 ring-inset transition-colors group-hover/al:bg-black/20" />
                </span>
                <span className="mt-1.5 block truncate text-xs font-medium">{a.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{a.artist}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TrackList({ blockId, tracks, title, compact }: { blockId: string; tracks: Track[] | null; title: string; compact?: boolean }) {
  const current = usePlayer((s) => (s.blockId === blockId ? currentTrack(s)?.id : undefined))
  const playing = usePlayer((s) => s.playing)
  if (!tracks) return <Loader2 className="mx-auto my-6 size-5 animate-spin text-muted-foreground" aria-label="Loading" />
  if (tracks.length === 0) return <p className="py-2 text-sm text-muted-foreground">No tracks.</p>
  return (
    <div>
      {!compact && (
        <div className="mb-2 flex gap-2">
          <button
            type="button"
            onClick={() => player.playTracks(blockId, tracks, 0, title, false)}
            className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Play className="size-3.5 fill-current" /> Play
          </button>
          <button
            type="button"
            onClick={() => player.playTracks(blockId, tracks, 0, title, true)}
            className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium hover:bg-secondary/80"
          >
            <Shuffle className="size-3.5" /> Shuffle
          </button>
        </div>
      )}
      <ol className="grid">
        {tracks.map((t, i) => {
          const isCurrent = current === t.id
          return (
            <li key={`${t.id}-${i}`}>
              <button
                type="button"
                onClick={() => player.playTracks(blockId, tracks, i, title)}
                aria-current={isCurrent ? "true" : undefined}
                className={cn("flex w-full items-center gap-3 rounded-md px-1.5 py-1.5 text-left hover:bg-accent/70", isCurrent && "text-primary")}
              >
                <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {isCurrent && playing ? <Volume2 className="ml-auto size-3.5 text-primary" aria-label="Playing" /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{t.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{t.artist}</span>
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">{formatTime(t.duration)}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function NowPlaying({ blockId, onShuffleAll }: { blockId: string; onShuffleAll: () => void }) {
  const mine = usePlayer((s) => s.blockId === blockId)
  const track = usePlayer((s) => (s.blockId === blockId ? currentTrack(s) : undefined))
  const { playing, loading, position, duration, shuffle, repeat, volume, error } = usePlayer()
  const [scrub, setScrub] = useState<number | null>(null)

  if (!mine || !track) {
    return (
      <div className="flex items-center gap-3 px-4 pb-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-md bg-muted">
          <Disc3 className="size-6 text-muted-foreground" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">Nothing playing</p>
          <p className="truncate text-xs text-muted-foreground">Pick an album, or let the server choose.</p>
        </div>
        <button
          type="button"
          onClick={onShuffleAll}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Shuffle className="size-3.5" /> Shuffle all
        </button>
      </div>
    )
  }

  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat
  const VolIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const total = duration || track.duration

  return (
    <div className="px-4 pb-3">
      <div className="flex items-center gap-3">
        <Cover blockId={blockId} id={track.coverArt} size={160} className="size-14 shadow-sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={track.title}>
            {track.title}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {error ?? [track.artist, track.album].filter(Boolean).join(", ")}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2 text-[0.7rem] text-muted-foreground tabular-nums">
        <span className="w-8 text-right">{formatTime(scrub ?? position)}</span>
        <Slider
          aria-label="Seek"
          min={0}
          max={Math.max(1, total)}
          step={1}
          value={[scrub ?? position]}
          onValueChange={([v]) => setScrub(v)}
          onValueCommit={([v]) => {
            player.seek(v)
            setScrub(null)
          }}
          className="flex-1"
        />
        <span className="w-8">{formatTime(total)}</span>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-0.5">
          <IconBtn label={shuffle ? "Shuffle on" : "Shuffle off"} active={shuffle} onClick={player.toggleShuffle}>
            <Shuffle />
          </IconBtn>
          <IconBtn label="Previous" onClick={player.prev}>
            <SkipBack className="fill-current" />
          </IconBtn>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => player.toggle()}
            className="mx-1 grid size-9 place-items-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 active:scale-95"
          >
            {loading && !playing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : playing ? (
              <Pause className="size-4 fill-current" />
            ) : (
              <Play className="ml-0.5 size-4 fill-current" />
            )}
          </button>
          <IconBtn label="Next" onClick={() => player.next()}>
            <SkipForward className="fill-current" />
          </IconBtn>
          <IconBtn label={`Repeat ${repeat}`} active={repeat !== "off"} onClick={player.cycleRepeat}>
            <RepeatIcon />
          </IconBtn>
        </div>
        <div className="hidden w-28 items-center gap-1.5 @[20rem]:flex">
          <button type="button" aria-label={volume === 0 ? "Unmute" : "Mute"} onClick={() => player.setVolume(volume === 0 ? 0.8 : 0)} className="text-muted-foreground hover:text-foreground">
            <VolIcon className="size-4" />
          </button>
          <Slider aria-label="Volume" min={0} max={1} step={0.01} value={[volume]} onValueChange={([v]) => player.setVolume(v)} />
        </div>
      </div>
    </div>
  )
}

function IconBtn({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "grid size-8 place-items-center rounded-full transition-colors hover:bg-accent [&_svg]:size-4",
        active ? "text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

/** Small "now playing" control in the header while the music block isn't on screen. */
export function MiniPlayer({ visibleBlockIds }: { visibleBlockIds: string[] }) {
  const blockId = usePlayer((s) => s.blockId)
  const track = usePlayer((s) => currentTrack(s))
  const playing = usePlayer((s) => s.playing)
  if (!blockId || !track || visibleBlockIds.includes(blockId)) return null
  return (
    <div className="flex items-center gap-2 rounded-full border bg-card py-1 pr-1 pl-1">
      <Cover blockId={blockId} id={track.coverArt} size={64} className="size-7 rounded-full" />
      <span className="max-w-40 min-w-0 truncate text-xs" title={`${track.title}, ${track.artist}`}>
        {track.title}
      </span>
      <IconBtn label={playing ? "Pause" : "Play"} onClick={() => player.toggle()}>
        {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
      </IconBtn>
      <IconBtn label="Next" onClick={() => player.next()}>
        <SkipForward className="fill-current" />
      </IconBtn>
      <IconBtn label="Stop" onClick={player.stop}>
        <X />
      </IconBtn>
    </div>
  )
}
