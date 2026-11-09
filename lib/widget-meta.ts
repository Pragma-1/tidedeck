import {
  AppWindow,
  Bookmark,
  CalendarDays,
  Clock,
  CloudSun,
  Cpu,
  Frame,
  LayoutGrid,
  Music,
  Rss,
  Search,
  StickyNote,
  type LucideIcon,
} from "lucide-react"
import { blockSchema, type Block, type BlockType } from "@/lib/schema"
import { uid } from "@/lib/utils"

export type WidgetMeta = {
  label: string
  description: string
  icon: LucideIcon
  size: { w: number; h: number }
  min: { w: number; h: number }
  create: () => Block
}

const make = (type: BlockType, title: string, props: Record<string, unknown> = {}, showTitle = true): Block =>
  blockSchema.parse({ id: uid(), type, title, showTitle, props })

export const newApp = (over: Record<string, unknown> = {}) => ({
  id: uid(),
  name: "New app",
  url: "",
  icon: "",
  description: "",
  target: "new" as const,
  statusCheck: true,
  statusUrl: "",
  insecureTls: true,
  ...over,
})

/** Entries in the "Add block" menu. "bookmarks" is a preset of the apps block. */
export const ADD_MENU: Array<{ key: string; meta: WidgetMeta }> = [
  {
    key: "app",
    meta: {
      label: "App",
      description: "One service as a tile, with online status",
      icon: AppWindow,
      size: { w: 2, h: 2 },
      min: { w: 1, h: 2 },
      create: () => make("app", "", { app: newApp() }, false),
    },
  },
  {
    key: "apps",
    meta: {
      label: "App group",
      description: "Several services under one heading",
      icon: LayoutGrid,
      size: { w: 4, h: 5 },
      min: { w: 2, h: 3 },
      create: () => make("apps", "Apps", { apps: [] }),
    },
  },
  {
    key: "bookmarks",
    meta: {
      label: "Bookmarks",
      description: "A compact list of links",
      icon: Bookmark,
      size: { w: 3, h: 5 },
      min: { w: 2, h: 3 },
      create: () => make("apps", "Bookmarks", { apps: [], display: "list", showStatus: false, showDescription: false }),
    },
  },
  {
    key: "search",
    meta: {
      label: "Search",
      description: "Find your apps or search the web. Press / to focus",
      icon: Search,
      size: { w: 6, h: 2 },
      min: { w: 2, h: 2 },
      create: () => make("search", "", {}, false),
    },
  },
  {
    key: "clock",
    meta: {
      label: "Clock",
      description: "Time and date, any time zone",
      icon: Clock,
      size: { w: 3, h: 2 },
      min: { w: 2, h: 2 },
      create: () => make("clock", "", {}, false),
    },
  },
  {
    key: "weather",
    meta: {
      label: "Weather",
      description: "Current conditions and forecast, no API key",
      icon: CloudSun,
      size: { w: 3, h: 5 },
      min: { w: 2, h: 3 },
      create: () => make("weather", "Weather"),
    },
  },
  {
    key: "system",
    meta: {
      label: "Server resources",
      description: "CPU, memory, disk and uptime of this host",
      icon: Cpu,
      size: { w: 3, h: 5 },
      min: { w: 2, h: 3 },
      create: () => make("system", "Server"),
    },
  },
  {
    key: "rss",
    meta: {
      label: "RSS feed",
      description: "Latest posts from one or more feeds",
      icon: Rss,
      size: { w: 4, h: 6 },
      min: { w: 2, h: 3 },
      create: () => make("rss", "News"),
    },
  },
  {
    key: "notes",
    meta: {
      label: "Notes",
      description: "Markdown text, checklists and links",
      icon: StickyNote,
      size: { w: 3, h: 4 },
      min: { w: 2, h: 2 },
      create: () => make("notes", "Notes", { content: "" }),
    },
  },
  {
    key: "music",
    meta: {
      label: "Music",
      description: "Play from Navidrome, or embed Spotify, YouTube or Deezer",
      icon: Music,
      size: { w: 4, h: 9 },
      min: { w: 3, h: 3 },
      create: () => make("music", "Music"),
    },
  },
  {
    key: "calendar",
    meta: {
      label: "Calendar",
      description: "This month at a glance",
      icon: CalendarDays,
      size: { w: 3, h: 6 },
      min: { w: 2, h: 5 },
      create: () => make("calendar", "", {}, false),
    },
  },
  {
    key: "iframe",
    meta: {
      label: "Embedded page",
      description: "Show another web page inside a block",
      icon: Frame,
      size: { w: 6, h: 8 },
      min: { w: 2, h: 3 },
      create: () => make("iframe", "Embed", { url: "" }),
    },
  },
]

const byType = new Map<BlockType, WidgetMeta>()
for (const { meta, key } of ADD_MENU) {
  const t = meta.create().type
  if (!byType.has(t) || key === t) byType.set(t, meta)
}

export const metaFor = (type: BlockType): WidgetMeta => byType.get(type)!
