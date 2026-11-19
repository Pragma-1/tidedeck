import { z } from "zod"
import { DEFAULT_DISPLAY, DISPLAY_WIDTHS, SIZE_MAX, SIZE_MIN, ZOOM_MAX, ZOOM_MIN, type Display } from "@/lib/display"
import { isSafeHref } from "@/lib/utils"
import { DEFAULT_SHORTCUTS, ENGINE_IDS, type EngineId } from "@/lib/search"
import { FONT_IDS, GRADIENT_IDS } from "@/lib/theme"
import { WEATHER_SOURCES } from "@/lib/weather"

export const displaySchema = z.object({
  scale: z.enum(["auto", "fixed"]).default("auto"),
  size: z.number().int().min(SIZE_MIN).max(SIZE_MAX).default(100),
  width: z.enum(DISPLAY_WIDTHS).default("standard"),
}) satisfies z.ZodType<Display, unknown>

const id = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/)
const href = z.string().max(2048).refine((v) => v === "" || isSafeHref(v), "Unsupported link scheme")
const httpUrl = z
  .string()
  .max(2048)
  .refine((v) => v === "" || /^https?:\/\//i.test(v.trim()), "Must start with http:// or https://")

export const appSchema = z.object({
  id,
  name: z.string().max(120).default("New app"),
  url: href.default(""),
  icon: z.string().max(2048).default(""),
  description: z.string().max(500).default(""),
  /** new tab, same tab, or an overlay on the dashboard (for apps that allow being embedded). */
  target: z.enum(["new", "same", "overlay"]).default("new"),
  statusCheck: z.boolean().default(true),
  statusUrl: httpUrl.default(""),
  insecureTls: z.boolean().default(true),
})
export type App = z.infer<typeof appSchema>

const zoomValue = z.number().min(ZOOM_MIN).max(ZOOM_MAX)
/** Content zoom per screen size (same keys as the layouts); missing = 100 %. */
const zoomSchema = z
  .object({ lg: zoomValue.optional(), md: zoomValue.optional(), sm: zoomValue.optional(), xs: zoomValue.optional() })
  .default({})
const base = { id, title: z.string().max(120).default(""), showTitle: z.boolean().default(true), zoom: zoomSchema }

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("app"), props: z.object({ app: appSchema }) }),
  z.object({
    ...base,
    type: z.literal("apps"),
    props: z.object({
      apps: z.array(appSchema).max(200).default([]),
      /** grid = tiles, list = rows, compact = small link chips (bookmarks). */
      display: z.enum(["grid", "list", "compact"]).default("grid"),
      /** custom = the stored order, which you arrange by dragging in edit mode. */
      sort: z.enum(["custom", "az", "za", "random"]).default("custom"),
      showDescription: z.boolean().default(true),
      showStatus: z.boolean().default(true),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("search"),
    props: z.object({
      engine: z.enum(ENGINE_IDS as [EngineId, ...EngineId[]]).default("duckduckgo"),
      customUrl: z.string().max(2048).default(""),
      searchApps: z.boolean().default(true),
      newTab: z.boolean().default(true),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("clock"),
    props: z.object({
      timezone: z.string().max(64).default(""),
      hour12: z.boolean().default(false),
      showSeconds: z.boolean().default(false),
      showDate: z.boolean().default(true),
      /** "Good morning, <name>" above the time; empty name = no name. */
      greeting: z.boolean().default(false),
      greetingName: z.string().max(40).default(""),
      /** Extra clocks under the main one. */
      zones: z
        .array(z.object({ label: z.string().max(40).default(""), timezone: z.string().max(64) }))
        .max(8)
        .default([]),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("weather"),
    props: z.object({
      place: z.string().max(120).default("Berlin"),
      latitude: z.number().min(-90).max(90).default(52.52),
      longitude: z.number().min(-180).max(180).default(13.405),
      units: z.enum(["metric", "imperial"]).default("metric"),
      forecastDays: z.number().int().min(0).max(7).default(4),
      source: z.enum(WEATHER_SOURCES).default("open-meteo"),
      // The place's time zone (from the place search); some sources need it to tell the days apart.
      timezone: z.string().max(64).regex(/^[A-Za-z0-9_+\-/]*$/).default(""),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("system"),
    props: z.object({
      diskPath: z.string().max(512).default("/"),
      showCpu: z.boolean().default(true),
      showMemory: z.boolean().default(true),
      showDisk: z.boolean().default(true),
      showUptime: z.boolean().default(true),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("rss"),
    props: z.object({
      feeds: z.array(httpUrl).max(20).default([]),
      limit: z.number().int().min(1).max(50).default(10),
      showSource: z.boolean().default(true),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("notes"),
    props: z.object({ content: z.string().max(50_000).default("") }),
  }),
  z.object({
    ...base,
    type: z.literal("checklist"),
    props: z.object({
      items: z
        .array(z.object({ id, text: z.string().max(300).default(""), done: z.boolean().default(false) }))
        .max(300)
        .default([]),
      /** Done items move to the bottom. */
      doneLast: z.boolean().default(true),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("iframe"),
    props: z.object({ url: httpUrl.default(""), allowFullscreen: z.boolean().default(true) }),
  }),
  z.object({
    ...base,
    type: z.literal("music"),
    props: z.object({
      source: z.enum(["navidrome", "spotify", "youtube", "deezer"]).default("navidrome"),
      /** Share link for the embedded players (Spotify, YouTube, Deezer). */
      link: z.string().max(2048).default(""),
      /** Navidrome: let people who aren't signed in play music too. */
      allowVisitors: z.boolean().default(false),
      /** Navidrome: transcode to this bitrate (0 = original file). */
      maxBitRate: z.union([z.literal(0), z.literal(128), z.literal(192), z.literal(320)]).default(0),
    }),
  }),
  z.object({
    ...base,
    type: z.literal("calendar"),
    props: z.object({ weekStart: z.enum(["monday", "sunday"]).default("monday") }),
  }),
])
export type Block = z.infer<typeof blockSchema>
export type BlockType = Block["type"]
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>

// Generous bounds (the board has no fixed size), but finite: a stored x of 10⁹
// would otherwise make every viewer's browser build a board that wide.
// Values outside are clamped rather than rejected, so an old file never fails to load.
const LIMITS = { x: [0, 2000], y: [0, 100_000], w: [1, 2000], h: [1, 10_000], hx: [0, 2000], hy: [0, 100_000], hw: [1, 2000] } as const
const clampItem = (v: unknown) => {
  if (!v || typeof v !== "object") return v
  const o = { ...(v as Record<string, unknown>) }
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    if (typeof o[k] === "number" && Number.isFinite(o[k])) o[k] = Math.min(hi, Math.max(lo, Math.round(o[k] as number)))
  }
  return o
}
export const layoutItemSchema = z.preprocess(
  clampItem,
  z.object({
    i: z.string().max(64),
    x: z.number().int().min(0).max(2000),
    y: z.number().int().min(0).max(100_000),
    w: z.number().int().min(1).max(2000),
    h: z.number().int().min(1).max(10_000),
    // Where the block was before another one pushed it away; it goes back there when there's room.
    hx: z.number().int().min(0).max(2000).optional(),
    hy: z.number().int().min(0).max(100_000).optional(),
    hw: z.number().int().min(1).max(2000).optional(),
  }),
)
const layoutSchema = z.preprocess((v) => (Array.isArray(v) ? v.slice(0, 300) : v), z.array(layoutItemSchema))
export type StoredLayoutItem = z.infer<typeof layoutItemSchema>

import { BREAKPOINTS, COLS, type BreakpointKey } from "@/lib/model"
export { BREAKPOINTS, COLS, type BreakpointKey }
/** Grid v2: twice the columns and half-height rows of v1, so blocks snap in finer steps. */

export const boardSchema = z.object({
  id,
  name: z.string().min(1).max(60),
  blocks: z.array(blockSchema).max(300).default([]),
  layouts: z
    .object({
      lg: layoutSchema.optional(),
      md: layoutSchema.optional(),
      sm: layoutSchema.optional(),
      xs: layoutSchema.optional(),
    })
    .default({}),
})
export type Board = z.infer<typeof boardSchema>

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const hexOrAuto = z.union([hex, z.literal("")])

/**
 * The page background, in layers from the bottom: the base (theme grey or your own
 * colour), an optional image (blurred, and darkened towards the base colour), and
 * an optional gradient on top. Each layer keeps its settings while switched off.
 */
const backgroundSchema = z.preprocess(
  (v) => {
    if (!v || typeof v !== "object" || "base" in v) return v
    // Up to 1.2 one of four was in use ("mode"); older files had only an image.
    const o = v as Record<string, unknown>
    const mode = typeof o.mode === "string" ? o.mode : o.imageUrl ? "image" : "theme"
    const { mode: _, ...rest } = o
    return { ...rest, base: mode === "color" ? "color" : "theme", gradientOn: mode === "gradient", imageOn: mode === "image" }
  },
  z.object({
    base: z.enum(["theme", "color"]).default("theme"),
    colorLight: hexOrAuto.default(""),
    colorDark: hexOrAuto.default(""),
    gradientOn: z.boolean().default(false),
    gradient: z.enum(GRADIENT_IDS).default("aurora"),
    imageOn: z.boolean().default(false),
    imageUrl: z.string().max(4096).default(""),
    blur: z.number().min(0).max(40).default(0),
    dim: z.number().min(0).max(90).default(40),
  }),
)

export const settingsSchema = z.object({
  title: z.string().max(60).default("Tidedeck"),
  theme: z.enum(["system", "dark", "light"]).default("system"),
  /** Last preset applied, for the settings UI only. */
  preset: z.string().max(32).default("tide"),
  accent: hex.default("#8eaedb"),
  /** Accent on light theme; empty = picked automatically. */
  accentLight: hexOrAuto.default(""),
  font: z.enum([...FONT_IDS, "custom"]).default("inter"),
  /** Name of a font installed on the viewing device, used when font = custom. */
  customFont: z
    .string()
    .max(60)
    .regex(/^[\w \-]*$/, "Letters, numbers, spaces and dashes only")
    .default(""),
  background: backgroundSchema.default({
    base: "theme",
    colorLight: "",
    colorDark: "",
    gradientOn: false,
    gradient: "aurora",
    imageOn: false,
    imageUrl: "",
    blur: 0,
    dim: 40,
  }),
  /** Header band colours; empty = theme default. */
  band: z.object({ light: hexOrAuto.default(""), dark: hexOrAuto.default("") }).default({ light: "", dark: "" }),
  cardOpacity: z.number().min(20).max(100).default(100),
  /** Dashboard size and page width; a device can override it locally. */
  display: displaySchema.default(DEFAULT_DISPLAY),
  /** Quick launch (type anywhere / Ctrl+K) and search shortcuts shared by every search. */
  search: z
    .object({
      quickLaunch: z.boolean().default(true),
      /** Typing a letter anywhere on the dashboard opens quick launch (edit mode is then Shift+E). */
      typeAnywhere: z.boolean().default(false),
      engine: z.enum(ENGINE_IDS as [EngineId, ...EngineId[]]).default("duckduckgo"),
      customUrl: z.string().max(2048).default(""),
      newTab: z.boolean().default(true),
      shortcuts: z
        .array(
          z.object({
            key: z.string().min(1).max(12).regex(/^[a-z0-9]+$/, "Lower-case letters and digits only"),
            name: z.string().max(40).default(""),
            url: httpUrl,
          }),
        )
        .max(40)
        .default(DEFAULT_SHORTCUTS),
    })
    .default({ quickLaunch: true, typeAnywhere: false, engine: "duckduckgo", customUrl: "", newTab: true, shortcuts: DEFAULT_SHORTCUTS }),
  statusInterval: z.number().int().min(10).max(3600).default(30),
  requireLoginToView: z.boolean().default(false),
  customCss: z.string().max(50_000).default(""),
})
export type Settings = z.infer<typeof settingsSchema>

/**
 * v1 → v2: the grid got twice as many columns and rows (rows 13 px instead of
 * 40, same 14 px gap), so doubling every position and size keeps each block
 * exactly where and as big as it was. Runs on load, on save and on import.
 */
/**
 * Older layouts in today's grid units, so nothing moves:
 * v1 → v2 doubled every value (12 → 24 columns, 27 → 13 px rows + gap);
 * v2 → v3 doubles columns (24 → 48) and triples rows (27 px → 9 px steps).
 */
function migrate(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw
  const cfg = raw as { version?: number; boards?: Array<{ layouts?: Record<string, Array<Record<string, number>>> }> }
  const version = cfg.version ?? 1
  if (version >= 3) return raw
  const f: Record<string, number> = version < 2 ? { x: 4, w: 4, y: 6, h: 6 } : { x: 2, w: 2, y: 3, h: 3 }
  const out = structuredClone(cfg)
  for (const board of out.boards ?? []) {
    for (const items of Object.values(board.layouts ?? {})) {
      for (const it of items ?? []) for (const k of ["x", "y", "w", "h"]) if (typeof it[k] === "number") it[k] *= f[k]
    }
  }
  out.version = 3
  return out
}

export const configSchema = z.preprocess(
  migrate,
  z
  .object({
    version: z.literal(3).default(3),
    settings: settingsSchema.default(settingsSchema.parse({})),
    boards: z.array(boardSchema).min(1).max(50),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>()
    for (const b of cfg.boards) {
      if (seen.has(b.id)) ctx.addIssue({ code: "custom", message: `Duplicate board id ${b.id}` })
      seen.add(b.id)
      const blockIds = new Set<string>()
      for (const blk of b.blocks) {
        if (blockIds.has(blk.id)) ctx.addIssue({ code: "custom", message: `Duplicate block id ${blk.id}` })
        blockIds.add(blk.id)
      }
    }
  }),
)
export type DashboardConfig = z.infer<typeof configSchema>

export { collectApps, findBlock } from "@/lib/model"
