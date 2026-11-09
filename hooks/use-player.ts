"use client"

import { create } from "zustand"

export type Track = { id: string; title: string; artist: string; album: string; albumId?: string; duration: number; coverArt?: string }
type Repeat = "off" | "all" | "one"

type PlayerState = {
  blockId: string | null
  queue: Track[]
  /** Queue order before shuffling, so turning shuffle off restores it. */
  original: Track[] | null
  index: number
  title: string
  playing: boolean
  loading: boolean
  position: number
  duration: number
  volume: number
  shuffle: boolean
  repeat: Repeat
  error: string | null
}

export const usePlayer = create<PlayerState>()(() => ({
  blockId: null,
  queue: [],
  original: null,
  index: 0,
  title: "",
  playing: false,
  loading: false,
  position: 0,
  duration: 0,
  volume: 0.8,
  shuffle: false,
  repeat: "off",
  error: null,
}))

const get = usePlayer.getState
const set = usePlayer.setState

export const currentTrack = (s: PlayerState = get()) => s.queue[s.index] as Track | undefined

const q = (v: string) => encodeURIComponent(v)
export const coverUrl = (blockId: string, coverArt?: string, size = 300) =>
  coverArt ? `/api/music/cover?block=${q(blockId)}&id=${q(coverArt)}&size=${size}` : null
const streamUrl = (blockId: string, id: string) => `/api/music/stream?block=${q(blockId)}&id=${q(id)}`

let audio: HTMLAudioElement | null = null
let scrobbled = false

function post(blockId: string, id: string, submission: boolean) {
  void fetch("/api/music/scrobble", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ block: blockId, id, submission }),
  }).catch(() => {})
}

function el(): HTMLAudioElement {
  if (audio) return audio
  const a = new Audio()
  a.preload = "auto"
  try {
    const v = Number(localStorage.getItem("tidedeck-volume"))
    if (v >= 0 && v <= 1 && localStorage.getItem("tidedeck-volume") !== null) set({ volume: v })
  } catch {}
  a.volume = get().volume

  let lastTick = 0
  a.addEventListener("timeupdate", () => {
    const now = performance.now()
    if (now - lastTick < 250) return
    lastTick = now
    set({ position: a.currentTime })
    const s = get()
    const t = currentTrack(s)
    const dur = Number.isFinite(a.duration) ? a.duration : s.duration
    // Count as played after half the track or four minutes, like most scrobblers.
    if (t && s.blockId && !scrobbled && dur > 0 && a.currentTime >= Math.min(dur / 2, 240)) {
      scrobbled = true
      post(s.blockId, t.id, true)
    }
  })
  a.addEventListener("loadedmetadata", () => Number.isFinite(a.duration) && set({ duration: a.duration }))
  a.addEventListener("playing", () => set({ playing: true, loading: false, error: null }))
  a.addEventListener("pause", () => set({ playing: false }))
  a.addEventListener("waiting", () => set({ loading: true }))
  a.addEventListener("ended", () => player.next(true))
  a.addEventListener("error", () => {
    if (!a.src) return
    set({ playing: false, loading: false, error: "This track couldn't be played" })
  })
  audio = a
  setupMediaSession()
  return a
}

function setupMediaSession() {
  if (!("mediaSession" in navigator)) return
  const ms = navigator.mediaSession
  const on = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
    try {
      ms.setActionHandler(action, fn)
    } catch {}
  }
  on("play", () => player.toggle(true))
  on("pause", () => player.toggle(false))
  on("nexttrack", () => player.next())
  on("previoustrack", () => player.prev())
  on("seekto", (d) => d.seekTime !== undefined && player.seek(d.seekTime))
}

function announce(t: Track, blockId: string) {
  if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return
  const art = coverUrl(blockId, t.coverArt, 512)
  navigator.mediaSession.metadata = new MediaMetadata({
    title: t.title,
    artist: t.artist,
    album: t.album,
    artwork: art ? [{ src: new URL(art, location.href).href, sizes: "512x512" }] : [],
  })
}

function load(index: number, autoplay = true) {
  const s = get()
  const t = s.queue[index]
  if (!t || !s.blockId) return
  const a = el()
  scrobbled = false
  set({ index, position: 0, duration: t.duration, error: null, loading: true })
  a.src = streamUrl(s.blockId, t.id)
  announce(t, s.blockId)
  if (autoplay) {
    a.play().catch((err: Error) => set({ playing: false, loading: false, error: err.name === "NotAllowedError" ? null : "Playback failed" }))
    post(s.blockId, t.id, false)
  }
}

function shuffled<T>(list: T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export const player = {
  playTracks(blockId: string, tracks: Track[], start = 0, title = "", shuffle?: boolean) {
    if (tracks.length === 0) return
    const useShuffle = shuffle ?? get().shuffle
    if (useShuffle) {
      const first = shuffle ? tracks[Math.floor(Math.random() * tracks.length)] : tracks[start]
      const rest = shuffled(tracks.filter((t) => t !== first))
      set({ blockId, title, queue: [first, ...rest], original: tracks, shuffle: true })
      load(0)
    } else {
      set({ blockId, title, queue: tracks, original: null, shuffle: false })
      load(start)
    }
  },

  toggle(force?: boolean) {
    const a = el()
    const s = get()
    if (!currentTrack(s)) return
    const play = force ?? a.paused
    if (play) {
      if (!a.src) return load(s.index)
      void a.play().catch(() => {})
    } else a.pause()
  },

  next(auto = false) {
    const s = get()
    if (auto && s.repeat === "one") {
      el().currentTime = 0
      void el().play().catch(() => {})
      return
    }
    if (s.index + 1 < s.queue.length) return load(s.index + 1)
    if (s.repeat === "all" && s.queue.length) return load(0)
    if (auto) set({ playing: false, position: 0 })
  },

  prev() {
    const s = get()
    if (el().currentTime > 3 || s.index === 0) return player.seek(0)
    load(s.index - 1)
  },

  jump(index: number) {
    load(index)
  },

  seek(seconds: number) {
    const a = el()
    if (Number.isFinite(seconds)) a.currentTime = Math.max(0, seconds)
    set({ position: a.currentTime })
  },

  setVolume(v: number) {
    const vol = Math.max(0, Math.min(1, v))
    el().volume = vol
    set({ volume: vol })
    try {
      localStorage.setItem("tidedeck-volume", String(vol))
    } catch {}
  },

  toggleShuffle() {
    const s = get()
    const cur = currentTrack(s)
    if (!cur) return set({ shuffle: !s.shuffle })
    if (!s.shuffle) {
      const rest = shuffled(s.queue.filter((_, i) => i !== s.index))
      set({ shuffle: true, original: s.queue, queue: [cur, ...rest], index: 0 })
    } else {
      const queue = s.original ?? s.queue
      set({ shuffle: false, original: null, queue, index: Math.max(0, queue.findIndex((t) => t.id === cur.id)) })
    }
  },

  cycleRepeat() {
    const order: Repeat[] = ["off", "all", "one"]
    set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] })
  },

  stop() {
    if (audio) {
      audio.pause()
      audio.removeAttribute("src")
      audio.load()
    }
    set({ blockId: null, queue: [], original: null, index: 0, playing: false, loading: false, position: 0, duration: 0, title: "" })
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null
  },
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00"
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}
