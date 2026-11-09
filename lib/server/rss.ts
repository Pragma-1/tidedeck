import { XMLParser } from "fast-xml-parser"

export type FeedItem = { title: string; link: string; date: string | null; source: string }

const MAX_BYTES = 5 * 1024 * 1024
const CACHE_MS = 10 * 60_000

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
  const doc = parser.parse(xml) as Node
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
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { "user-agent": "Tidedeck feed reader", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
  })
  if (!res.ok) throw new Error(`Feed answered HTTP ${res.status}`)
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("Feed is larger than 5 MB")
  const buf = await res.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) throw new Error("Feed is larger than 5 MB")
  return parseFeed(new TextDecoder().decode(buf))
}

export function getFeed(url: string): Promise<FeedItem[]> {
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items
  const items = fetchFeed(url)
  cache.set(url, { at: Date.now(), items })
  items.catch(() => cache.delete(url))
  return items
}
