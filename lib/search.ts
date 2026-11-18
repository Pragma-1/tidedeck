import { isSafeHref } from "@/lib/utils"

export const ENGINES = {
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  google: { name: "Google", url: "https://www.google.com/search?q=%s" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q=%s" },
  startpage: { name: "Startpage", url: "https://www.startpage.com/do/search?q=%s" },
  brave: { name: "Brave Search", url: "https://search.brave.com/search?q=%s" },
  custom: { name: "your search engine", url: "" },
} as const
export type EngineId = keyof typeof ENGINES
export const ENGINE_IDS = Object.keys(ENGINES) as EngineId[]
export const ENGINE_NAMES = Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v.name])) as Record<EngineId, string>

export type Shortcut = { key: string; name: string; url: string }

/** Search shortcuts ("bangs"): type `!yt lofi` to search YouTube for "lofi". */
export const DEFAULT_SHORTCUTS: Shortcut[] = [
  { key: "g", name: "Google", url: "https://www.google.com/search?q=%s" },
  { key: "ddg", name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  { key: "yt", name: "YouTube", url: "https://www.youtube.com/results?search_query=%s" },
  { key: "w", name: "Wikipedia", url: "https://en.wikipedia.org/w/index.php?search=%s" },
  { key: "gh", name: "GitHub", url: "https://github.com/search?q=%s" },
  { key: "dh", name: "Docker Hub", url: "https://hub.docker.com/search?q=%s" },
  { key: "r", name: "Reddit", url: "https://www.reddit.com/search/?q=%s" },
  { key: "maps", name: "OpenStreetMap", url: "https://www.openstreetmap.org/search?query=%s" },
]

export const engineTemplate = (engine: EngineId, customUrl: string) => (engine === "custom" ? customUrl : ENGINES[engine].url)

/** Fills a `%s` template; a template without `%s` just opens as it is. */
export function fillTemplate(template: string, term: string): string | null {
  const url = template.includes("%s") ? template.replaceAll("%s", encodeURIComponent(term)) : template
  return /^https?:\/\//i.test(url) && isSafeHref(url) ? url : null
}

/** `!key rest` → the shortcut and the rest; also matches a bare `!key`. */
export function parseShortcut(input: string, shortcuts: Shortcut[]): { shortcut: Shortcut; term: string } | null {
  const m = /^!(\S+)(?:\s+([\s\S]*))?$/.exec(input.trim())
  if (!m) return null
  const shortcut = shortcuts.find((s) => s.key.toLowerCase() === m[1].toLowerCase())
  return shortcut ? { shortcut, term: (m[2] ?? "").trim() } : null
}

/** "nas.lan:5000", "10.0.2.5", "https://x" → a URL to open directly; anything with spaces isn't one. */
export function asUrl(input: string): string | null {
  const t = input.trim()
  if (!t || /\s/.test(t)) return null
  if (/^https?:\/\//i.test(t)) return isSafeHref(t) ? t : null
  // host (with a dot, or an IP/localhost), optional port and path
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3}|[\w-]+(\.[\w-]+)+)(:\d{1,5})?(\/\S*)?$/i.test(t)) {
    const scheme = /^(localhost|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[\w-]+\.(lan|local|home|internal|arpa))/i.test(t) ? "http" : "https"
    return `${scheme}://${t}`
  }
  return null
}
