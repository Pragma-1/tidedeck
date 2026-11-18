import {
  AppWindow,
  Bookmark,
  CalendarDays,
  Clock,
  CloudSun,
  Cpu,
  Frame,
  LayoutGrid,
  ListChecks,
  Music,
  Rss,
  Search,
  StickyNote,
  type LucideIcon,
} from "lucide-react"
import { blockSchema, type Block, type BlockType } from "@/lib/schema"
import { uid } from "@/lib/utils"
import { BLOCK_INFO } from "@/lib/block-info"

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
export const ADD_MENU: Array<{ key: string; type: BlockType; meta: WidgetMeta }> = [
  {
    key: "app",
    type: "app",
    meta: {
      ...BLOCK_INFO.app,
      description: "One service as a tile, with online status",
      icon: AppWindow,
      create: () => make("app", "", { app: newApp() }, false),
    },
  },
  {
    key: "apps",
    type: "apps",
    meta: {
      ...BLOCK_INFO.apps,
      description: "Several services under one heading",
      icon: LayoutGrid,
      create: () => make("apps", "Apps", { apps: [] }),
    },
  },
  {
    key: "bookmarks",
    type: "apps",
    meta: {
      label: "Bookmarks",
      description: "A compact list of links",
      icon: Bookmark,
      size: { w: 12, h: 30 },
      min: { w: 8, h: 18 },
      create: () => make("apps", "Bookmarks", { apps: [], display: "list", showStatus: false, showDescription: false }),
    },
  },
  {
    key: "search",
    type: "search",
    meta: {
      ...BLOCK_INFO.search,
      description: "Find your apps or search the web. Press / to focus",
      icon: Search,
      create: () => make("search", "", {}, false),
    },
  },
  {
    key: "clock",
    type: "clock",
    meta: {
      ...BLOCK_INFO.clock,
      description: "Time and date, any time zone",
      icon: Clock,
      create: () => make("clock", "", {}, false),
    },
  },
  {
    key: "weather",
    type: "weather",
    meta: {
      ...BLOCK_INFO.weather,
      description: "Current conditions and forecast, no API key",
      icon: CloudSun,
      create: () => make("weather", "Weather"),
    },
  },
  {
    key: "system",
    type: "system",
    meta: {
      ...BLOCK_INFO.system,
      description: "CPU, memory, disk and uptime of this host",
      icon: Cpu,
      create: () => make("system", "Server"),
    },
  },
  {
    key: "rss",
    type: "rss",
    meta: {
      ...BLOCK_INFO.rss,
      description: "Latest posts from one or more feeds",
      icon: Rss,
      create: () => make("rss", "News"),
    },
  },
  {
    key: "notes",
    type: "notes",
    meta: {
      ...BLOCK_INFO.notes,
      description: "Markdown text, checklists and links",
      icon: StickyNote,
      create: () => make("notes", "Notes", { content: "" }),
    },
  },
  {
    key: "checklist",
    type: "checklist",
    meta: {
      ...BLOCK_INFO.checklist,
      description: "A to-do list you tick off right on the dashboard",
      icon: ListChecks,
      create: () =>
        make("checklist", "To do", {
          items: [
            { id: uid(), text: "Update the containers", done: false },
            { id: uid(), text: "Renew the certificate", done: false },
          ],
        }),
    },
  },
  {
    key: "music",
    type: "music",
    meta: {
      ...BLOCK_INFO.music,
      description: "Play from Navidrome, or embed Spotify, YouTube or Deezer",
      icon: Music,
      create: () => make("music", "Music"),
    },
  },
  {
    key: "calendar",
    type: "calendar",
    meta: {
      ...BLOCK_INFO.calendar,
      description: "This month at a glance",
      icon: CalendarDays,
      create: () => make("calendar", "", {}, false),
    },
  },
  {
    key: "iframe",
    type: "iframe",
    meta: {
      ...BLOCK_INFO.iframe,
      description: "Show another web page inside a block",
      icon: Frame,
      create: () => make("iframe", "Embed", { url: "" }),
    },
  },
]

/** The "Add block" entry of a block type itself (not a preset like Bookmarks). */
const byType = new Map<BlockType, WidgetMeta>(ADD_MENU.filter((e) => e.key === e.type).map((e) => [e.type, e.meta]))

export const metaFor = (type: BlockType): WidgetMeta => byType.get(type) ?? { ...BLOCK_INFO[type], description: "", icon: LayoutGrid, create: () => make(type, "") }
