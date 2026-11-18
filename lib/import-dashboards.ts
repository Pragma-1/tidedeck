import { parse } from "yaml"
import { appSchema, blockSchema, boardSchema, type Block, type Board, type StoredLayoutItem } from "@/lib/schema"
import { isSafeHref, uid } from "@/lib/utils"

/**
 * Turns the config of another dashboard into a Tidedeck board of app groups.
 *
 * - Homepage: services.yaml and bookmarks.yaml
 * - Dashy: conf.yml (sections → items, also inside pages)
 * - Homer: config.yml (services → items)
 *
 * Only names, links, descriptions, icons and the way links open are taken over;
 * widgets and API integrations of those dashboards have no equivalent here.
 */

export type ImportResult = { source: string; board: Board; groups: number; apps: number; skipped: number }

type RawApp = { name: string; url: string; description?: string; icon?: string; target?: string }
type RawGroup = { name: string; apps: RawApp[] }

export const MAX_IMPORT_BYTES = 1024 * 1024

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "")
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** Maps the icon notations of other dashboards onto Tidedeck's (see lib/icons.ts). */
function mapIcon(raw: string): string {
  const v = raw.trim()
  if (!v) return ""
  if (/^https?:\/\//i.test(v)) return v
  // selfh.st icons: Homepage "sh-name.png", Dashy "sh-name"
  const sh = /^sh-([a-z0-9-]+?)(?:\.(png|svg|webp))?$/i.exec(v)
  if (sh) return `sh:${sh[1].toLowerCase()}`
  // dashboard-icons: Homepage "name.png", Dashy "hl-name"
  const di = /^(?:hl-)?([a-z0-9-]+)\.(png|svg|webp)$/i.exec(v) ?? /^hl-([a-z0-9-]+)$/i.exec(v)
  if (di) return di[1].toLowerCase()
  // Font Awesome, Material Design Icons, simple-icons, "favicon", relative asset paths: no equivalent → favicon
  return ""
}

const mapTarget = (t: string) => (/^(_self|sametab|_top|top|parent|_parent)$/i.test(t) ? "same" : /^modal$/i.test(t) ? "overlay" : "new")

// --- Readers ------------------------------------------------------------------

/** Homepage services.yaml / bookmarks.yaml: `- Group: [ - Name: {href,…} | [ {href,…} ] ]` */
function readHomepage(doc: unknown): RawGroup[] | null {
  if (!Array.isArray(doc) || !doc.every((g) => isObj(g) && Object.keys(g).length === 1)) return null
  const groups: RawGroup[] = []
  for (const g of doc as Record<string, unknown>[]) {
    const [name, items] = Object.entries(g)[0]
    if (!Array.isArray(items)) continue
    const apps: RawApp[] = []
    for (const it of items) {
      if (!isObj(it)) continue
      const [appName, rawVal] = Object.entries(it)[0] ?? []
      // services: an object; bookmarks: a one-element list; nested sub-groups are flattened
      const val = Array.isArray(rawVal) ? rawVal.find(isObj) : rawVal
      if (Array.isArray(rawVal) && rawVal.every((x) => isObj(x) && Object.keys(x).length === 1 && !("href" in x))) {
        const sub = readHomepage([{ [appName!]: rawVal }])
        if (sub) apps.push(...sub.flatMap((s) => s.apps))
        continue
      }
      if (!isObj(val)) continue
      apps.push({
        name: str(appName),
        url: str(val.href),
        description: str(val.description),
        icon: str(val.icon),
        target: str(val.target),
      })
    }
    groups.push({ name: str(name), apps })
  }
  return groups.some((g) => g.apps.length) ? groups : null
}

/** Dashy conf.yml: `sections: [ {name, items: [ {title, url, description, icon, target} ]} ]` */
function readDashy(doc: unknown): RawGroup[] | null {
  if (!isObj(doc)) return null
  const sections = [
    ...(Array.isArray(doc.sections) ? doc.sections : []),
    ...(Array.isArray(doc.pages) ? doc.pages.flatMap((p) => (isObj(p) && Array.isArray(p.sections) ? p.sections : [])) : []),
  ]
  if (!sections.length || !sections.every(isObj) || !sections.some((s) => Array.isArray((s as Record<string, unknown>).items))) return null
  return (sections as Record<string, unknown>[]).map((s) => ({
    name: str(s.name),
    apps: (Array.isArray(s.items) ? s.items : []).filter(isObj).map((i) => ({
      name: str(i.title),
      url: str(i.url),
      description: str(i.description),
      icon: str(i.icon),
      target: str(i.target),
    })),
  }))
}

/** Homer config.yml: `services: [ {name, items: [ {name, subtitle, url, logo|icon, target} ]} ]` */
function readHomer(doc: unknown): RawGroup[] | null {
  if (!isObj(doc) || !Array.isArray(doc.services) || !doc.services.every(isObj)) return null
  return (doc.services as Record<string, unknown>[]).map((s) => ({
    name: str(s.name),
    apps: (Array.isArray(s.items) ? s.items : []).filter(isObj).map((i) => ({
      name: str(i.name),
      url: str(i.url),
      description: str(i.subtitle),
      // Homer's logo is usually a path inside Homer's own assets folder, which Tidedeck can't reach.
      icon: /^https?:\/\//i.test(str(i.logo)) ? str(i.logo) : "",
      target: str(i.target),
    })),
  }))
}

// --- Building the board -------------------------------------------------------

export function importDashboard(text: string): ImportResult {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new Error("The file is larger than 1 MB.")
  let doc: unknown
  try {
    // YAML is a superset of JSON. Alias expansion is capped, so a "billion laughs" file fails fast.
    doc = parse(text, { maxAliasCount: 50, prettyErrors: false, strict: false, uniqueKeys: false })
  } catch (e) {
    throw new Error(`That isn't valid YAML: ${(e as Error).message.split("\n")[0]}`)
  }
  const readers: [string, (d: unknown) => RawGroup[] | null][] = [
    ["Dashy", readDashy],
    ["Homer", readHomer],
    ["Homepage", readHomepage],
  ]
  let source = ""
  let groups: RawGroup[] | null = null
  for (const [name, read] of readers) {
    groups = read(doc)
    if (groups) {
      source = name
      break
    }
  }
  if (!groups) throw new Error("No apps found. Supported: Homepage services.yaml or bookmarks.yaml, Dashy conf.yml, Homer config.yml.")

  let skipped = 0
  let total = 0
  const blocks: Block[] = []
  for (const g of groups.slice(0, 60)) {
    const apps = []
    for (const a of g.apps) {
      if (!a.url || !isSafeHref(a.url) || apps.length >= 200) {
        skipped++
        continue
      }
      const parsed = appSchema.safeParse({
        id: uid(),
        name: (a.name || a.url).slice(0, 120),
        url: a.url.slice(0, 2048),
        description: (a.description ?? "").slice(0, 500),
        icon: mapIcon(a.icon ?? ""),
        target: mapTarget(a.target ?? ""),
      })
      if (parsed.success) apps.push(parsed.data)
      else skipped++
    }
    if (!apps.length) continue
    total += apps.length
    blocks.push(
      blockSchema.parse({ id: uid(), type: "apps", title: (g.name || "Apps").slice(0, 120), props: { apps, display: "grid", showStatus: false } }),
    )
  }
  if (!blocks.length) throw new Error("The file has groups, but none of their links could be used.")

  // Masonry: three columns of 16 (of 48) on the wide layout, each group as tall as its tiles need.
  const heights = [0, 0, 0]
  const lg: StoredLayoutItem[] = blocks.map((b) => {
    const n = b.type === "apps" ? b.props.apps.length : 1
    const h = (3 + Math.ceil(n / 2) * 2) * 3
    const col = heights.indexOf(Math.min(...heights))
    const item = { i: b.id, x: col * 16, y: heights[col], w: 16, h }
    heights[col] += h
    return item
  })
  const board = boardSchema.parse({ id: uid(), name: `From ${source}`.slice(0, 60), blocks, layouts: { lg } })
  return { source, board, groups: blocks.length, apps: total, skipped }
}
