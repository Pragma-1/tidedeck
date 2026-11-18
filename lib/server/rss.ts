import { XMLParser } from "fast-xml-parser"
import { readLimited } from "@/lib/server/http"

export type FeedItem = { title: string; link: string; date: string | null; source: string }

const MAX_BYTES = 5 * 1024 * 1024
const CACHE_MS = 10 * 60_000
const FAILED_CACHE_MS = 2 * 60_000

const g = globalThis as unknown as { __tidedeckRss?: Map<string, { at: number; items: Promise<FeedItem[]> }> }
const cache = (g.__tidedeckRss ??= new Map())

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  processEntities: true,
  htmlEntities: true,
})

type Node = Record<string, unknown>
const arr = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])

function text(v: unknown): string {
  if (typeof v === "string") return v
  if (typeof v === "number") return String(v)
  if (v && typeof v === "object" && "#text" in v) return String((v as Node)["#text"])
  return ""
}

function clean(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
}

function safeLink(s: string): string {
  return /^https?:\/\//i.test(s.trim()) ? s.trim() : ""
}

function atomLink(v: unknown): string {
  const links = arr(v as Node | Node[])
  const alt = links.find((l) => typeof l === "object" && (!l["@_rel"] || l["@_rel"] === "alternate"))
  if (alt && typeof alt === "object") return String(alt["@_href"] ?? "")
  return text(links[0])
}

function toIso(s: string): string | null {
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function parseFeed(xml: string): FeedItem[] {
  // Feeds never need DOCTYPE entities; dropping them stops entity-expansion ("billion laughs") attacks from a hostile feed.
  const safe = xml.replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/gi, "").replace(/<!ENTITY[\s\S]*?>/gi, "")
  const doc = parser.parse(safe) as Node
  const rss = doc.rss as Node | undefined
  const rdf = doc["rdf:RDF"] as Node | undefined
  const atom = doc.feed as Node | undefined

  if (rss?.channel || rdf) {
    const channel = (rss?.channel ?? rdf?.channel) as Node
    const source = clean(text(channel?.title))
    const items = arr((rss ? (channel?.item as Node[]) : (rdf?.item as Node[])) ?? [])
    return items.map((it) => ({
      title: clean(text(it.title)) || "Untitled",
      link: safeLink(text(it.link)),
      date: toIso(text(it.pubDate) || text(it["dc:date"])),
      source,
    }))
  }
  if (atom) {
    const source = clean(text(atom.title))
    return arr(atom.entry as Node[]).map((e) => ({
      title: clean(text(e.title)) || "Untitled",
      link: safeLink(atomLink(e.link)),
      date: toIso(text(e.published) || text(e.updated)),
      source,
    }))
  }
  throw new Error("Not an RSS or Atom feed")
}

async function fetchFeed(url: string): Promise<FeedItem[]> {
  const signal = AbortSignal.timeout(10_000)
  // Redirects are followed by hand: at most 5, and only to http(s).
  let target = url
  let res: Response
  for (let hop = 0; ; hop++) {
    res = await fetch(target, {
      signal,
      redirect: "manual",
      headers: { "user-agent": "Tidedeck feed reader", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    })
    const location = res.headers.get("location")
    if (res.status < 300 || res.status >= 400 || !location) break
    await res.body?.cancel().catch(() => {})
    if (hop >= 5) throw new Error("Too many redirects")
    target = new URL(location, target).href
    if (!/^https?:\/\//i.test(target)) throw new Error("Feed redirected to an unsupported address")
  }
  if (!res.ok) throw new Error(`Feed answered HTTP ${res.status}`)
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("Feed is larger than 5 MB")
  // Read with a running limit: a feed without Content-Length can't stream gigabytes into memory.
  const buf = await readLimited(res as unknown as { body: AsyncIterable<Uint8Array> | null }, MAX_BYTES)
  return parseFeed(new TextDecoder().decode(buf))
}

export function getFeed(url: string): Promise<FeedItem[]> {
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items
  const items = fetchFeed(url)
  const entry = { at: Date.now(), items }
  cache.set(url, entry)
  // Failures are cached for a shorter time, so visitors can't make the server re-fetch a broken feed nonstop.
  items.catch(() => void (entry.at = Date.now() - CACHE_MS + FAILED_CACHE_MS))
  if (cache.size > 500) cache.delete(cache.keys().next().value!)
  return items
}
