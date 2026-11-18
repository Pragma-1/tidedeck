"use client"

import { useEffect, useMemo, useState, type ComponentType } from "react"
import type { App, BlockOf } from "@/lib/schema"
import { cn } from "@/lib/utils"
import { AppIcon, AppLink, StatusDot } from "@/components/widgets/app-tile"
import { useHydrationLocale } from "@/hooks/use-locale-context"
import { loadPart } from "@/lib/stale-build"

// Re-ordering tiles by drag (edit mode) brings its own drag library: loaded with the editor.
type ArrangeProps = { block: BlockOf<"apps">; ordered: App[] }
let Arrange: ComponentType<ArrangeProps> | null = null
export const loadArrangeApps = loadPart(() => import("@/components/widgets/arrange-apps").then((m) => void (Arrange = m.ArrangeApps)), { resumeEdit: true })

/** Single app: stacks vertically in narrow blocks, goes horizontal when there's room. */
export function AppWidget({ block }: { block: BlockOf<"app"> }) {
  const app = block.props.app
  return (
    <AppLink app={app} blockId={block.id} className="relative flex h-full items-center rounded-xl transition-colors hover:bg-accent/60">
      <div className="flex w-full flex-col items-center gap-2 p-3 text-center @[15rem]:flex-row @[15rem]:gap-3.5 @[15rem]:px-4 @[15rem]:text-left">
        <AppIcon app={app} className="size-10 text-lg @[15rem]:size-11" />
        <div className="min-w-0">
          <div className="truncate font-medium leading-tight">{app.name || "Untitled"}</div>
          {app.description && <div className="mt-0.5 hidden truncate text-sm text-muted-foreground @[9rem]:block">{app.description}</div>}
        </div>
      </div>
      <StatusDot app={app} className="absolute top-3 right-3" />
    </AppLink>
  )
}

// --- Ordering ---------------------------------------------------------------

type Sort = BlockOf<"apps">["props"]["sort"]

/** Small seeded PRNG, so a random order stays put until the page is reloaded. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const collators = new Map<string, Intl.Collator>()
const collatorFor = (locale: string | undefined) => {
  const key = locale ?? ""
  let c = collators.get(key)
  if (!c) collators.set(key, (c = new Intl.Collator(locale, { sensitivity: "base", numeric: true })))
  return c
}

export function orderApps(apps: App[], sort: Sort, seed: number | null, locale?: string): App[] {
  const collator = collatorFor(locale)
  if (sort === "az") return [...apps].sort((a, b) => collator.compare(a.name, b.name))
  if (sort === "za") return [...apps].sort((a, b) => collator.compare(b.name, a.name))
  if (sort === "random" && seed !== null) {
    const rand = mulberry32(seed)
    const out = [...apps]
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  return apps
}

// --- App group --------------------------------------------------------------

const GRID = "grid grid-cols-1 gap-1.5 px-2 pb-2 @[20rem]:grid-cols-2 @[34rem]:grid-cols-3 @[50rem]:grid-cols-4"
const LIST = "flex flex-col px-2 pb-2"
const COMPACT = "flex flex-wrap content-start gap-1.5 px-3 pb-3"
export type Display = BlockOf<"apps">["props"]["display"]
export const listClass = (d: Display) => (d === "list" ? LIST : d === "compact" ? COMPACT : GRID)

export function TileBody({ app, display, showDescription, showStatus }: { app: App } & Pick<BlockOf<"apps">["props"], "display" | "showDescription" | "showStatus">) {
  if (display === "compact") {
    return (
      <>
        <AppIcon app={app} className="size-4 text-[0.6rem]" />
        <span className="max-w-[14rem] truncate text-sm">{app.name}</span>
        {showStatus && <StatusDot app={app} className="size-[0.55rem]" />}
      </>
    )
  }
  if (display === "list") {
    return (
      <>
        <AppIcon app={app} className="size-5 text-[0.7rem]" />
        <span className="min-w-0 flex-1 truncate text-sm">{app.name}</span>
        {showDescription && app.description && <span className="hidden truncate text-xs text-muted-foreground @[18rem]:inline">{app.description}</span>}
        {showStatus && <StatusDot app={app} />}
      </>
    )
  }
  return (
    <>
      <AppIcon app={app} className="size-8 text-sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-tight">{app.name}</span>
        {showDescription && app.description && <span className="block truncate text-xs text-muted-foreground">{app.description}</span>}
      </span>
      {showStatus && <StatusDot app={app} />}
    </>
  )
}

export const rowClass = (display: Display) =>
  display === "compact"
    ? "flex items-center gap-2 rounded-full border bg-muted/50 py-1 pr-3 pl-2 transition-colors"
    : display === "list"
      ? "flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors"
      : "relative flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors"

export function AppsWidget({ block, editing }: { block: BlockOf<"apps">; editing: boolean }) {
  const { apps, display, showDescription, showStatus, sort } = block.props
  // Random order is decided after mount so server and browser render the same HTML first.
  const [seed, setSeed] = useState<number | null>(null)
  useEffect(() => {
    if (sort === "random") setSeed(Math.floor(Math.random() * 2 ** 31))
  }, [sort])
  // A–Z sorts like the browser does once loaded; while hydrating, like the server did.
  const locale = useHydrationLocale("en")
  const ordered = useMemo(() => orderApps(apps, sort, seed, locale), [apps, sort, seed, locale])
  const [, loaded] = useState(0)
  useEffect(() => {
    if (editing && !Arrange)
      void loadArrangeApps().then(
        () => loaded((n) => n + 1),
        (err: unknown) => console.error("Tidedeck: re-ordering couldn't be loaded", err),
      )
  }, [editing])

  if (apps.length === 0) {
    return <p className="px-4 pb-4 text-sm text-muted-foreground">{editing ? "Open this block's settings to add links." : "No links yet."}</p>
  }

  if (editing && Arrange) return <Arrange block={block} ordered={ordered} />

  return (
    <ul className={listClass(display)}>
      {ordered.map((app) => (
        <li key={app.id} title={display === "compact" && app.description ? app.description : undefined}>
          <AppLink app={app} blockId={block.id} className={cn(rowClass(display), "hover:bg-accent/70")}>
            <TileBody app={app} display={display} showDescription={showDescription} showStatus={showStatus} />
          </AppLink>
        </li>
      ))}
    </ul>
  )
}
