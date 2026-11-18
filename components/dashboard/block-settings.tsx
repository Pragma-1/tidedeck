"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, CheckCircle2, ChevronDown, GripVertical, Loader2, Plus, Search, Trash2 } from "lucide-react"
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Field, IconPicker, ToggleRow, httpError } from "@/components/dashboard/fields"
import { AppIcon } from "@/components/widgets/app-tile"
import { ENGINE_NAMES } from "@/components/widgets/search-widget"
import { flushSave, useDashboard } from "@/hooks/use-dashboard"
import { embedUrl } from "@/lib/music-embed"
import { findBlock } from "@/lib/model"
import type { App, Block, BlockOf, BreakpointKey } from "@/lib/schema"
import { setBlockZoom } from "@/lib/board-ops"
import { ZOOM_MAX, ZOOM_MIN } from "@/lib/display"
import { Slider } from "@/components/ui/slider"
import { cn, isSafeHref } from "@/lib/utils"
import { metaFor, newApp } from "@/lib/widget-meta"
import { SOURCE_INFO, WEATHER_KEYS_EVENT, WEATHER_SOURCES, type KeyedSource } from "@/lib/weather"

type Setter<B extends Block> = (fn: (b: B) => void) => void

export function BlockSettingsDialog() {
  const blockId = useDashboard((s) => s.editingBlockId)
  const config = useDashboard((s) => s.config)
  const close = useDashboard((s) => s.openBlockSettings)
  const updateBlock = useDashboard((s) => s.updateBlock)
  const block = blockId ? findBlock(config, blockId) : undefined

  const set = (fn: (b: Block) => void) => blockId && updateBlock(blockId, fn)
  const meta = block ? metaFor(block.type) : null

  return (
    <Dialog open={!!block} onOpenChange={(o) => !o && close(null)}>
      {block && meta && (
        <DialogContent
          className="sm:max-w-xl"
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).focus()
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <meta.icon className="size-5 text-primary" aria-hidden />
              {meta.label}
            </DialogTitle>
            <DialogDescription>Changes apply right away.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-5">
            {block.type !== "app" && (
              <div className="grid gap-3">
                <Field label="Title">
                  {(id) => <Input id={id} value={block.title} onChange={(e) => set((b) => void (b.title = e.target.value))} />}
                </Field>
                <ToggleRow label="Show title" checked={block.showTitle} onCheckedChange={(v) => set((b) => void (b.showTitle = v))} />
              </div>
            )}
            <Body block={block} set={set} />
            <ZoomField block={block} set={set} />
          </div>

          <DialogFooter>
            <Button onClick={() => close(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}

const SCREEN_NAMES: Record<BreakpointKey, string> = { lg: "large screens", md: "medium screens", sm: "small screens", xs: "phones" }

/** Content zoom for the screen size the board is shown at right now. */
function ZoomField({ block, set }: { block: Block; set: Setter<Block> }) {
  const bp = useDashboard((s) => s.breakpoint)
  const pct = Math.round((block.zoom[bp] ?? 1) * 100)
  return (
    <Field
      label={`Content zoom ${pct}%`}
      hint={`Applies on ${SCREEN_NAMES[bp]}, like the layout. With a mouse or trackpad: Ctrl + scroll or pinch over the block in edit mode.`}
    >
      {() => (
        <div className="flex items-center gap-3">
          <Slider
            aria-label="Content zoom"
            min={ZOOM_MIN * 100}
            max={ZOOM_MAX * 100}
            step={5}
            value={[pct]}
            onValueChange={([v]) => set((b) => setBlockZoom(b, bp, v / 100))}
          />
          <Button variant="ghost" size="sm" disabled={pct === 100} onClick={() => set((b) => setBlockZoom(b, bp, 1))}>
            Reset
          </Button>
        </div>
      )}
    </Field>
  )
}

function Body({ block, set }: { block: Block; set: Setter<Block> }) {
  switch (block.type) {
    case "app":
      return <AppFields app={block.props.app} onChange={(fn) => set((b) => b.type === "app" && fn(b.props.app))} />
    case "apps":
      return <AppsSettings block={block} set={set as Setter<BlockOf<"apps">>} />
    case "search":
      return <SearchSettings block={block} set={set as Setter<BlockOf<"search">>} />
    case "clock":
      return <ClockSettings block={block} set={set as Setter<BlockOf<"clock">>} />
    case "weather":
      return <WeatherSettings block={block} set={set as Setter<BlockOf<"weather">>} />
    case "system":
      return <SystemSettings block={block} set={set as Setter<BlockOf<"system">>} />
    case "rss":
      return <RssSettings block={block} set={set as Setter<BlockOf<"rss">>} />
    case "notes":
      return (
        <Field label="Text" hint="Markdown works: **bold**, lists, - [ ] checkboxes, tables and links.">
          {(id) => (
            <Textarea
              id={id}
              rows={12}
              value={block.props.content}
              onChange={(e) => set((b) => b.type === "notes" && void (b.props.content = e.target.value))}
            />
          )}
        </Field>
      )
    case "iframe":
      return (
        <div className="grid gap-3">
          <Field
            label="Page address"
            error={httpError(block.props.url)}
            hint="Some sites refuse to be shown inside other pages. If the block stays blank, that site blocks embedding."
          >
            {(id) => (
              <Input
                id={id}
                value={block.props.url}
                placeholder="https://grafana.local/d/abc"
                onChange={(e) => set((b) => b.type === "iframe" && void (b.props.url = e.target.value))}
              />
            )}
          </Field>
          <ToggleRow
            label="Allow full screen"
            checked={block.props.allowFullscreen}
            onCheckedChange={(v) => set((b) => b.type === "iframe" && void (b.props.allowFullscreen = v))}
          />
        </div>
      )
    case "music":
      return <MusicSettings block={block} set={set as Setter<BlockOf<"music">>} />
    case "checklist":
      return (
        <div className="grid gap-3.5">
          <ToggleRow
            label="Done items move to the bottom"
            checked={block.props.doneLast}
            onCheckedChange={(v) => set((b) => b.type === "checklist" && void (b.props.doneLast = v))}
          />
          <p className="text-sm text-muted-foreground">
            Add, tick and remove items right on the dashboard while signed in (outside edit mode). Visitors see the list but can&apos;t change it.
          </p>
        </div>
      )
    case "calendar":
      return (
        <Field label="Week starts on">
          {(id) => (
            <Select
              value={block.props.weekStart}
              onValueChange={(v) => set((b) => b.type === "calendar" && void (b.props.weekStart = v as "monday" | "sunday"))}
            >
              <SelectTrigger id={id}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monday">Monday</SelectItem>
                <SelectItem value="sunday">Sunday</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
      )
  }
}

// --- Apps -------------------------------------------------------------------

function AppFields({ app, onChange }: { app: App; onChange: (fn: (a: App) => void) => void }) {
  const urlError = app.url && !isSafeHref(app.url) ? "This kind of link isn't allowed" : null
  return (
    <div className="grid gap-3.5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          {(id) => <Input id={id} value={app.name} onChange={(e) => onChange((a) => void (a.name = e.target.value))} />}
        </Field>
        <Field label="Description">
          {(id) => (
            <Input id={id} value={app.description} placeholder="Optional" onChange={(e) => onChange((a) => void (a.description = e.target.value))} />
          )}
        </Field>
      </div>
      <Field label="Link" error={urlError}>
        {(id) => (
          <Input id={id} value={app.url} placeholder="https://proxmox.local:8006" onChange={(e) => onChange((a) => void (a.url = e.target.value))} />
        )}
      </Field>
      <IconPicker value={app.icon} appUrl={app.url} appName={app.name} onChange={(v) => onChange((a) => void (a.icon = v))} />
      <Field
        label="Open in"
        hint={
          app.target === "overlay"
            ? "Shows the app in a panel on top of the dashboard. Some apps refuse to be shown inside other pages; use a tab for those."
            : "Right-click an app for the other ways to open it; Alt+click opens it on top of the dashboard."
        }
      >
        {(id) => (
          <Select value={app.target} onValueChange={(v) => onChange((a) => void (a.target = v as App["target"]))}>
            <SelectTrigger id={id}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New tab</SelectItem>
              <SelectItem value="same">Same tab</SelectItem>
              <SelectItem value="overlay">On top of the dashboard</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>
      <ToggleRow
        label="Check if it's online"
        description="The server pings the link and shows a dot. Login pages count as online."
        checked={app.statusCheck}
        onCheckedChange={(v) => onChange((a) => void (a.statusCheck = v))}
      />
      {app.statusCheck && (
        <div className="grid gap-3 border-l-2 border-primary/30 pl-4">
          <Field label="Check a different address" error={httpError(app.statusUrl)} hint="Optional, for example an internal IP or a /health endpoint.">
            {(id) => (
              <Input id={id} value={app.statusUrl} placeholder="http://10.0.2.5:8006" onChange={(e) => onChange((a) => void (a.statusUrl = e.target.value))} />
            )}
          </Field>
          <ToggleRow
            label="Accept self-signed certificates"
            description="Needed for services that use their own HTTPS certificate."
            checked={app.insecureTls}
            onCheckedChange={(v) => onChange((a) => void (a.insecureTls = v))}
          />
        </div>
      )}
    </div>
  )
}

function AppsSettings({ block, set }: { block: BlockOf<"apps">; set: Setter<BlockOf<"apps">> }) {
  const [open, setOpen] = useState<string | null>(null)
  const apps = block.props.apps
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  // Re-ordering the list here also means "use my order".
  const reorder = (from: number, to: number) =>
    set((b) => {
      if (to < 0 || to >= b.props.apps.length) return
      b.props.apps = arrayMove(b.props.apps, from, to)
      b.props.sort = "custom"
    })
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const ids = apps.map((a) => a.id)
    reorder(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Layout">
          {(id) => (
            <Select value={block.props.display} onValueChange={(v) => set((b) => void (b.props.display = v as typeof b.props.display))}>
              <SelectTrigger id={id}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="grid">Tiles</SelectItem>
                <SelectItem value="list">List</SelectItem>
                <SelectItem value="compact">Compact (bookmarks)</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Order" hint={
            block.props.sort === "custom"
              ? "Drag the tiles on the dashboard or the rows below."
              : block.props.sort === "random"
                ? "Shuffled every time the page loads. Dragging a tile switches to Custom."
                : "Dragging a tile or row switches to Custom."
          }>
          {(id) => (
            <Select value={block.props.sort} onValueChange={(v) => set((b) => void (b.props.sort = v as typeof b.props.sort))}>
              <SelectTrigger id={id}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom</SelectItem>
                <SelectItem value="az">A to Z</SelectItem>
                <SelectItem value="za">Z to A</SelectItem>
                <SelectItem value="random">Random</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
      </div>
      <ToggleRow label="Show descriptions" checked={block.props.showDescription} onCheckedChange={(v) => set((b) => void (b.props.showDescription = v))} />
      <ToggleRow label="Show online status" checked={block.props.showStatus} onCheckedChange={(v) => set((b) => void (b.props.showStatus = v))} />

      <div className="grid gap-1.5">
        <div className="text-sm font-medium">Links</div>
        {apps.length === 0 && <p className="text-sm text-muted-foreground">No links yet.</p>}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={apps.map((a) => a.id)} strategy={verticalListSortingStrategy}>
            <ul className="grid gap-1.5">
              {apps.map((app, i) => (
                <SortableRow key={app.id} id={app.id} name={app.name}>
                  {(handle) => (
                    <>
                      <div className="flex items-center gap-1.5 p-1.5">
                        {handle}
                        <AppIcon app={app} className="size-6 text-xs" />
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left text-sm"
                          onClick={() => setOpen(open === app.id ? null : app.id)}
                          aria-expanded={open === app.id}
                        >
                          <span className="font-medium">{app.name || "Untitled"}</span>
                          <span className="ml-2 text-muted-foreground">{app.url}</span>
                        </button>
                        <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} onClick={() => reorder(i, i - 1)}>
                          <ArrowUp />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={i === apps.length - 1} onClick={() => reorder(i, i + 1)}>
                          <ArrowDown />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${app.name}`}
                          onClick={() => set((b) => void (b.props.apps = b.props.apps.filter((a) => a.id !== app.id)))}
                        >
                          <Trash2 />
                        </Button>
                        <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setOpen(open === app.id ? null : app.id)}>
                          <ChevronDown className={open === app.id ? "rotate-180 transition-transform" : "transition-transform"} />
                        </Button>
                      </div>
                      {open === app.id && (
                        <div className="border-t p-3">
                          <AppFields
                            app={app}
                            onChange={(fn) =>
                              set((b) => {
                                const target = b.props.apps.find((a) => a.id === app.id)
                                if (target) fn(target)
                              })
                            }
                          />
                        </div>
                      )}
                    </>
                  )}
                </SortableRow>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <Button
          variant="outline"
          className="mt-1 w-fit"
          onClick={() => {
            const app = newApp({ statusCheck: block.props.showStatus })
            set((b) => void b.props.apps.push(app))
            setOpen(app.id)
          }}
        >
          <Plus /> Add link
        </Button>
      </div>
    </div>
  )
}

function SortableRow({ id, name, children }: { id: string; name: string; children: (handle: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`Move ${name || "link"}`}
      className="grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted-foreground hover:bg-accent active:cursor-grabbing"
    >
      <GripVertical className="size-4" />
    </button>
  )
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("rounded-lg border bg-popover", isDragging && "relative z-10 shadow-xl ring-2 ring-primary")}
    >
      {children(handle)}
    </li>
  )
}

// --- Widgets ----------------------------------------------------------------

function SearchSettings({ block, set }: { block: BlockOf<"search">; set: Setter<BlockOf<"search">> }) {
  const p = block.props
  const customError = p.engine === "custom" && !p.customUrl.includes("%s") ? "Put %s where the search term goes" : httpError(p.customUrl)
  return (
    <div className="grid gap-3.5">
      <Field label="Web search">
        {(id) => (
          <Select value={p.engine} onValueChange={(v) => set((b) => void (b.props.engine = v as typeof p.engine))}>
            <SelectTrigger id={id}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ENGINE_NAMES).map(([k, name]) => (
                <SelectItem key={k} value={k}>
                  {k === "custom" ? "Custom (e.g. SearXNG)" : name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      {p.engine === "custom" && (
        <Field label="Search address" error={customError} hint="%s is replaced by what you type.">
          {(id) => (
            <Input id={id} value={p.customUrl} placeholder="https://search.local/search?q=%s" onChange={(e) => set((b) => void (b.props.customUrl = e.target.value))} />
          )}
        </Field>
      )}
      <ToggleRow label="Suggest matching apps" description="Shows your apps while you type." checked={p.searchApps} onCheckedChange={(v) => set((b) => void (b.props.searchApps = v))} />
      <ToggleRow label="Open results in a new tab" checked={p.newTab} onCheckedChange={(v) => set((b) => void (b.props.newTab = v))} />
    </div>
  )
}

function ClockSettings({ block, set }: { block: BlockOf<"clock">; set: Setter<BlockOf<"clock">> }) {
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone")
    } catch {
      return []
    }
  }, [])
  const p = block.props
  const tzError = p.timezone && zones.length > 0 && !zones.includes(p.timezone) ? "Unknown time zone" : null
  return (
    <div className="grid gap-3.5">
      <Field label="Time zone" error={tzError} hint="Leave empty to use the time zone of the device viewing the dashboard.">
        {(id) => (
          <>
            <Input id={id} list={`${id}-zones`} value={p.timezone} placeholder="Europe/Berlin" onChange={(e) => set((b) => void (b.props.timezone = e.target.value))} />
            <datalist id={`${id}-zones`}>
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      <ToggleRow label="12-hour clock" checked={p.hour12} onCheckedChange={(v) => set((b) => void (b.props.hour12 = v))} />
      <ToggleRow label="Show seconds" checked={p.showSeconds} onCheckedChange={(v) => set((b) => void (b.props.showSeconds = v))} />
      <ToggleRow label="Show date" checked={p.showDate} onCheckedChange={(v) => set((b) => void (b.props.showDate = v))} />
      <ToggleRow
        label="Greeting"
        description="“Good morning” above the time, changing through the day."
        checked={p.greeting}
        onCheckedChange={(v) => set((b) => void (b.props.greeting = v))}
      />
      {p.greeting && (
        <Field label="Name in the greeting" hint="Optional.">
          {(id) => <Input id={id} value={p.greetingName} maxLength={40} placeholder="Alex" onChange={(e) => set((b) => void (b.props.greetingName = e.target.value))} />}
        </Field>
      )}
      <div className="grid gap-2">
        <span className="text-sm font-medium">More time zones</span>
        {p.zones.map((z, i) => {
          const bad = z.timezone && zones.length > 0 && !zones.includes(z.timezone)
          return (
            <div key={i} className="flex items-start gap-2">
              <Input
                aria-label="Label"
                className="w-32 shrink-0"
                value={z.label}
                maxLength={40}
                placeholder={z.timezone.split("/").pop()?.replace(/_/g, " ") || "Label"}
                onChange={(e) => set((b) => void (b.props.zones[i].label = e.target.value))}
              />
              <div className="min-w-0 flex-1">
                <Input
                  aria-label="Time zone"
                  aria-invalid={bad || undefined}
                  list="tz-list"
                  value={z.timezone}
                  placeholder="America/New_York"
                  onChange={(e) => set((b) => void (b.props.zones[i].timezone = e.target.value))}
                />
                {bad && <p className="mt-1 text-xs text-destructive">Unknown time zone</p>}
              </div>
              <Button variant="ghost" size="icon" aria-label="Remove time zone" onClick={() => set((b) => void b.props.zones.splice(i, 1))}>
                <Trash2 />
              </Button>
            </div>
          )
        })}
        <datalist id="tz-list">
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        {p.zones.length < 8 && (
          <Button variant="outline" size="sm" className="w-fit" onClick={() => set((b) => void b.props.zones.push({ label: "", timezone: "" }))}>
            <Plus /> Add time zone
          </Button>
        )}
      </div>
    </div>
  )
}

type GeoResult = { id: number; name: string; country?: string; admin1?: string; latitude: number; longitude: number; timezone?: string }

function WeatherSettings({ block, set }: { block: BlockOf<"weather">; set: Setter<BlockOf<"weather">> }) {
  const p = block.props
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<GeoResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const info = SOURCE_INFO[p.source]

  useEffect(() => setResults(null), [p.latitude, p.longitude])

  const find = async () => {
    if (!query.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=6&name=${encodeURIComponent(query.trim())}`)
      const json = (await res.json()) as { results?: GeoResult[] }
      setResults(json.results ?? [])
    } catch {
      setResults([])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3.5">
      <Field label="Place" hint={`Now showing ${p.place} (${p.latitude.toFixed(2)}, ${p.longitude.toFixed(2)}).`}>
        {(id) => (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void find()
            }}
          >
            <Input id={id} value={query} placeholder="Search a city" onChange={(e) => setQuery(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={busy}>
              <Search /> Find
            </Button>
          </form>
        )}
      </Field>
      {results && (
        <ul className="grid gap-1 rounded-lg border p-1">
          {results.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">No place found with that name.</li>}
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() =>
                  set((b) => {
                    b.props.place = r.name.slice(0, 120)
                    b.props.latitude = r.latitude
                    b.props.longitude = r.longitude
                    b.props.timezone = typeof r.timezone === "string" && /^[A-Za-z0-9_+\-/]{1,64}$/.test(r.timezone) ? r.timezone : ""
                  })
                }
              >
                {r.name}
                <span className="text-muted-foreground">{[r.admin1, r.country].filter(Boolean).map((s) => `, ${s}`).join("")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Field label="Weather source" hint={info.hint}>
        {(id) => (
          <Select value={p.source} onValueChange={(v) => set((b) => void (b.props.source = v as typeof p.source))}>
            <SelectTrigger id={id}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEATHER_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SOURCE_INFO[s].name}
                  {SOURCE_INFO[s].keyed ? "" : " (no key needed)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      {info.keyed && <WeatherKeyForm key={info.keyed} source={info.keyed} blockId={block.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Units">
          {(id) => (
            <Select value={p.units} onValueChange={(v) => set((b) => void (b.props.units = v as typeof p.units))}>
              <SelectTrigger id={id}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="metric">°C, km/h</SelectItem>
                <SelectItem value="imperial">°F, mph</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Forecast days" hint={p.forecastDays > info.maxDays ? `${info.name} forecasts ${info.maxDays} days at most.` : undefined}>
          {(id) => (
            <Select value={String(p.forecastDays)} onValueChange={(v) => set((b) => void (b.props.forecastDays = Number(v)))}>
              <SelectTrigger id={id}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n === 0 ? "None" : n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      </div>
    </div>
  )
}

type KeyStatus = { openweathermap: boolean; weatherapi: boolean; google: boolean; apple: { teamId: string; serviceId: string; keyId: string } | null }

/** The key of a weather source: saved once on the server, for every weather block. */
function WeatherKeyForm({ source, blockId }: { source: KeyedSource; blockId: string }) {
  const info = SOURCE_INFO[source]
  const [status, setStatus] = useState<KeyStatus | null>(null)
  const [apiKey, setApiKey] = useState("")
  const [teamId, setTeamId] = useState("")
  const [keyId, setKeyId] = useState("")
  const [serviceId, setServiceId] = useState("")
  const [privateKey, setPrivateKey] = useState("")
  const [state, setState] = useState<{ busy: boolean; ok?: string; error?: string }>({ busy: false })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const res = await fetch("/api/weather/keys", { cache: "no-store" }).catch(() => null)
      if (!res?.ok || cancelled) return
      const s = (await res.json()) as KeyStatus
      setStatus(s)
      if (s.apple) {
        setTeamId(s.apple.teamId)
        setKeyId(s.apple.keyId)
        setServiceId(s.apple.serviceId)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const saved = source === "apple" ? !!status?.apple : !!status?.[source]

  const send = async (payload: Record<string, unknown>, done: string) => {
    setState({ busy: true })
    // The key is tried where the block is: save its place first.
    await flushSave()
    const res = await fetch("/api/weather/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, block: blockId, ...payload }),
    }).catch(() => null)
    const body = (await res?.json().catch(() => ({}))) ?? {}
    if (res?.ok) {
      setState({ busy: false, ok: done })
      setApiKey("")
      setPrivateKey("")
      const removed = payload.remove === true
      setStatus((s) => {
        const next = { ...(s ?? { openweathermap: false, weatherapi: false, google: false, apple: null }) }
        if (source === "apple") next.apple = removed ? null : { teamId: teamId.trim().toUpperCase(), keyId: keyId.trim().toUpperCase(), serviceId: serviceId.trim() }
        else next[source] = !removed
        return next
      })
      window.dispatchEvent(new Event(WEATHER_KEYS_EVENT))
    } else setState({ busy: false, error: body.error ?? (res ? `Server answered ${res.status}` : "Can't reach the Tidedeck server.") })
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    void send(source === "apple" ? { teamId, keyId, serviceId, privateKey } : { apiKey }, "The key works and is saved.")
  }
  const keep = saved ? "Saved. Leave empty to keep it" : ""
  const ready = source === "apple" ? !!(teamId && keyId && serviceId && (privateKey || saved)) : !!apiKey

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border p-3.5">
      {source === "apple" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Team ID">
              {(id) => <Input id={id} autoComplete="off" spellCheck={false} value={teamId} placeholder="ABCDE12345" onChange={(e) => setTeamId(e.target.value)} />}
            </Field>
            <Field label="Key ID">
              {(id) => <Input id={id} autoComplete="off" spellCheck={false} value={keyId} placeholder="FGHIJ67890" onChange={(e) => setKeyId(e.target.value)} />}
            </Field>
          </div>
          <Field label="Services ID">
            {(id) => (
              <Input id={id} autoComplete="off" spellCheck={false} value={serviceId} placeholder="com.example.weather" onChange={(e) => setServiceId(e.target.value)} />
            )}
          </Field>
          <Field label="Private key (.p8)">
            {(id) => (
              <Textarea
                id={id}
                rows={4}
                autoComplete="off"
                spellCheck={false}
                className="font-kbd text-xs"
                value={privateKey}
                placeholder={keep || "-----BEGIN PRIVATE KEY-----"}
                onChange={(e) => setPrivateKey(e.target.value)}
              />
            )}
          </Field>
        </>
      ) : (
        <Field label={`${info.name} API key`}>
          {(id) => (
            <Input id={id} type="password" autoComplete="off" spellCheck={false} value={apiKey} placeholder={keep} onChange={(e) => setApiKey(e.target.value)} />
          )}
        </Field>
      )}
      <p className="text-xs text-muted-foreground">
        Saved encrypted on the Tidedeck server, once for all weather blocks, and never sent to browsers. The server loads the weather and shares it with
        every viewer, at most every 10 minutes per block.{" "}
        {info.signup && (
          <a href={info.signup} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            Get a key
          </a>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" disabled={state.busy || !ready}>
          {state.busy && <Loader2 className="animate-spin" />}
          Save and test
        </Button>
        {saved && (
          <Button type="button" variant="ghost" disabled={state.busy} onClick={() => void send({ remove: true }, "The key was removed.")}>
            Remove key
          </Button>
        )}
        {state.ok && (
          <span className="flex items-center gap-1.5 text-sm text-ok">
            <CheckCircle2 className="size-4" /> {state.ok}
          </span>
        )}
        {state.error && <span className="text-sm text-destructive">{state.error}</span>}
        {!state.ok && !state.error && saved && <span className="text-xs text-muted-foreground">A key is saved.</span>}
      </div>
    </form>
  )
}

function SystemSettings({ block, set }: { block: BlockOf<"system">; set: Setter<BlockOf<"system">> }) {
  const p = block.props
  return (
    <div className="grid gap-3.5">
      <Field label="Disk to measure" hint="A path inside the container. Mount a host disk (e.g. /mnt/tank:/mnt/tank:ro) to see its usage.">
        {(id) => <Input id={id} value={p.diskPath} onChange={(e) => set((b) => void (b.props.diskPath = e.target.value))} />}
      </Field>
      <ToggleRow label="CPU" checked={p.showCpu} onCheckedChange={(v) => set((b) => void (b.props.showCpu = v))} />
      <ToggleRow label="Memory" checked={p.showMemory} onCheckedChange={(v) => set((b) => void (b.props.showMemory = v))} />
      <ToggleRow label="Disk" checked={p.showDisk} onCheckedChange={(v) => set((b) => void (b.props.showDisk = v))} />
      <ToggleRow label="Uptime and load" checked={p.showUptime} onCheckedChange={(v) => set((b) => void (b.props.showUptime = v))} />
    </div>
  )
}

function RssSettings({ block, set }: { block: BlockOf<"rss">; set: Setter<BlockOf<"rss">> }) {
  const p = block.props
  const [text, setText] = useState(p.feeds.join("\n"))
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
  const bad = lines.find((l) => !/^https?:\/\//i.test(l))
  return (
    <div className="grid gap-3.5">
      <Field label="Feeds" hint="One feed address per line. RSS and Atom both work." error={bad ? `“${bad}” doesn't start with http(s)://` : null}>
        {(id) => (
          <Textarea
            id={id}
            rows={4}
            value={text}
            placeholder="https://github.com/homarr-labs/homarr/releases.atom"
            onChange={(e) => {
              setText(e.target.value)
              const next = e.target.value.split("\n").map((l) => l.trim()).filter(Boolean)
              if (next.every((l) => /^https?:\/\//i.test(l))) set((b) => void (b.props.feeds = next.slice(0, 20)))
            }}
          />
        )}
      </Field>
      <Field label="Number of posts">
        {(id) => (
          <Input
            id={id}
            type="number"
            min={1}
            max={50}
            value={p.limit}
            onChange={(e) => set((b) => void (b.props.limit = Math.max(1, Math.min(50, Number(e.target.value) || 1))))}
          />
        )}
      </Field>
      <FeedHelper
        onAdd={(url) => {
          const next = [...lines.filter((l) => l !== url), url].slice(0, 20)
          setText(next.join("\n"))
          if (next.every((l) => /^https?:\/\//i.test(l))) set((b) => void (b.props.feeds = next))
        }}
      />
      <ToggleRow label="Show feed name" checked={p.showSource} onCheckedChange={(v) => set((b) => void (b.props.showSource = v))} />
    </div>
  )
}

/** Feed addresses people look up every time: GitHub releases, YouTube channels, subreddits. */
const FEED_KINDS = {
  github: { label: "GitHub releases", placeholder: "owner/repo", make: (v: string) => /^[\w.-]+\/[\w.-]+$/.test(v) ? `https://github.com/${v}/releases.atom` : null },
  youtube: {
    label: "YouTube channel",
    placeholder: "Channel ID (UC…)",
    make: (v: string) => (/^UC[\w-]{20,24}$/.test(v) ? `https://www.youtube.com/feeds/videos.xml?channel_id=${v}` : null),
  },
  reddit: { label: "Subreddit", placeholder: "selfhosted", make: (v: string) => (/^[\w]{2,21}$/.test(v.replace(/^r\//, "")) ? `https://www.reddit.com/r/${v.replace(/^r\//, "")}/.rss` : null) },
} as const

function FeedHelper({ onAdd }: { onAdd: (url: string) => void }) {
  const [kind, setKind] = useState<keyof typeof FEED_KINDS>("github")
  const [value, setValue] = useState("")
  const url = FEED_KINDS[kind].make(value.trim())
  return (
    <Field label="Add a feed by name" hint={url ? url : "Fills in the feed address for you."}>
      {(id) => (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (url) {
              onAdd(url)
              setValue("")
            }
          }}
        >
          <Select value={kind} onValueChange={(v) => setKind(v as keyof typeof FEED_KINDS)}>
            <SelectTrigger className="w-40" aria-label="Kind of feed">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FEED_KINDS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input id={id} className="min-w-0 flex-1" value={value} placeholder={FEED_KINDS[kind].placeholder} onChange={(e) => setValue(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={!url}>
            Add
          </Button>
        </form>
      )}
    </Field>
  )
}

// --- Music ------------------------------------------------------------------

const MUSIC_HINTS = {
  spotify: "Paste a Spotify playlist, album, track or podcast link. Full songs play when you're signed in to Spotify in this browser; otherwise Spotify plays 30-second previews.",
  youtube: "Paste a YouTube or YouTube Music playlist or video link. YouTube Music's own site can't be embedded, so it plays in the YouTube player.",
  deezer: "Paste a Deezer playlist, album or track link (the full deezer.com address, not a short link). Deezer's embedded player only plays 30-second previews of songs; podcasts play in full.",
}

function MusicSettings({ block, set }: { block: BlockOf<"music">; set: Setter<BlockOf<"music">> }) {
  const p = block.props
  return (
    <div className="grid gap-4">
      <Field label="Play from">
        {(id) => (
          <Select value={p.source} onValueChange={(v) => set((b) => void (b.props.source = v as typeof p.source))}>
            <SelectTrigger id={id}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="navidrome">Navidrome (or any Subsonic server)</SelectItem>
              <SelectItem value="spotify">Spotify</SelectItem>
              <SelectItem value="youtube">YouTube / YouTube Music</SelectItem>
              <SelectItem value="deezer">Deezer</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>

      {p.source === "navidrome" ? (
        <>
          <NavidromeAccount blockId={block.id} />
          <Field label="Streaming quality" hint="Lower bitrates save bandwidth when you listen from outside your network. Navidrome converts on the fly.">
            {(id) => (
              <Select value={String(p.maxBitRate)} onValueChange={(v) => set((b) => void (b.props.maxBitRate = Number(v) as typeof p.maxBitRate))}>
                <SelectTrigger id={id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Original files</SelectItem>
                  <SelectItem value="320">320 kbps</SelectItem>
                  <SelectItem value="192">192 kbps</SelectItem>
                  <SelectItem value="128">128 kbps</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
          <ToggleRow
            label="Let visitors play music"
            description="When off, only you (signed in) can browse and play. When on, anyone who can see the dashboard can stream your library through it."
            checked={p.allowVisitors}
            onCheckedChange={(v) => set((b) => void (b.props.allowVisitors = v))}
          />
        </>
      ) : (
        <Field
          label="Link"
          hint={MUSIC_HINTS[p.source]}
          error={p.link && !embedUrl(p.source, p.link) ? "That link isn't one this player understands" : null}
        >
          {(id) => (
            <Input
              id={id}
              value={p.link}
              placeholder={
                p.source === "spotify"
                  ? "https://open.spotify.com/playlist/…"
                  : p.source === "deezer"
                    ? "https://www.deezer.com/playlist/…"
                    : "https://music.youtube.com/playlist?list=…"
              }
              onChange={(e) => set((b) => void (b.props.link = e.target.value))}
            />
          )}
        </Field>
      )}
    </div>
  )
}

type AccountInfo = { configured: boolean; url: string; username: string; hasPassword: boolean; hasApiKey: boolean; insecureTls: boolean }

function NavidromeAccount({ blockId }: { blockId: string }) {
  const [info, setInfo] = useState<AccountInfo | null>(null)
  const [url, setUrl] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [useKey, setUseKey] = useState(false)
  const [insecureTls, setInsecureTls] = useState(true)
  const [state, setState] = useState<{ busy: boolean; ok?: string; error?: string }>({ busy: false })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await flushSave()
      const res = await fetch(`/api/music/account?block=${encodeURIComponent(blockId)}`, { cache: "no-store" })
      if (!res.ok || cancelled) return
      const a = (await res.json()) as AccountInfo
      setInfo(a)
      setUrl(a.url)
      setUsername(a.username)
      setUseKey(a.hasApiKey)
      setInsecureTls(a.insecureTls)
    })()
    return () => {
      cancelled = true
    }
  }, [blockId])

  const connect = async (e: React.FormEvent) => {
    e.preventDefault()
    setState({ busy: true })
    await flushSave()
    const res = await fetch("/api/music/account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        block: blockId,
        url,
        username,
        password: useKey ? "" : password,
        apiKey: useKey ? apiKey : "",
        clearApiKey: !useKey,
        insecureTls,
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok) {
      setState({ busy: false, ok: `Connected to ${body.server}` })
      setPassword("")
      setApiKey("")
      setInfo((i) => ({ ...(i ?? ({} as AccountInfo)), configured: true, hasPassword: !useKey || !!i?.hasPassword, hasApiKey: useKey }))
    } else setState({ busy: false, error: body.error ?? `Server answered ${res.status}` })
  }

  return (
    <form onSubmit={connect} className="grid gap-3 rounded-lg border p-3.5">
      <Field label="Server address" error={httpError(url)}>
        {(id) => <Input id={id} value={url} placeholder="https://music.example.com" onChange={(e) => setUrl(e.target.value)} />}
      </Field>
      {useKey ? (
        <Field label="API key" hint="Create one in your server's user settings (OpenSubsonic API keys).">
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder={info?.hasApiKey ? "Saved. Leave empty to keep it" : ""}
              onChange={(e) => setApiKey(e.target.value)}
            />
          )}
        </Field>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Username">
            {(id) => <Input id={id} autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />}
          </Field>
          <Field label="Password">
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={password}
                placeholder={info?.hasPassword ? "Saved. Leave empty to keep it" : ""}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
        </div>
      )}
      <button type="button" className="w-fit text-xs text-muted-foreground underline underline-offset-2" onClick={() => setUseKey((v) => !v)}>
        {useKey ? "Use username and password instead" : "Use an API key instead"}
      </button>
      <ToggleRow label="Accept self-signed certificates" checked={insecureTls} onCheckedChange={setInsecureTls} />
      <p className="text-xs text-muted-foreground">
        The login is stored encrypted on the Tidedeck server and never sent to browsers. Music streams through Tidedeck, so it also works when Navidrome is only reachable inside your network.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" disabled={state.busy || !url}>
          {state.busy && <Loader2 className="animate-spin" />}
          {info?.configured ? "Save and test" : "Connect"}
        </Button>
        {state.ok && (
          <span className="flex items-center gap-1.5 text-sm text-ok">
            <CheckCircle2 className="size-4" /> {state.ok}
          </span>
        )}
        {state.error && <span className="text-sm text-destructive">{state.error}</span>}
        {!state.ok && !state.error && info?.configured && <span className="text-xs text-muted-foreground">Connected as {info.username || "API key"}</span>}
      </div>
    </form>
  )
}
