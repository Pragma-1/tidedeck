import { z } from "zod"
import { isSafeHref } from "@/lib/utils"

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
  target: z.enum(["new", "same"]).default("new"),
  statusCheck: z.boolean().default(true),
  statusUrl: httpUrl.default(""),
  insecureTls: z.boolean().default(true),
})
export type App = z.infer<typeof appSchema>

const base = { id, title: z.string().max(120).default(""), showTitle: z.boolean().default(true) }

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("app"), props: z.object({ app: appSchema }) }),
  z.object({
    ...base,
    type: z.literal("apps"),
    props: z.object({
      apps: z.array(appSchema).max(200).default([]),
      display: z.enum(["grid", "list"]).default("grid"),
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
      engine: z.enum(["duckduckgo", "google", "bing", "startpage", "brave", "custom"]).default("duckduckgo"),
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

export const layoutItemSchema = z.object({
  i: z.string(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
})
export type StoredLayoutItem = z.infer<typeof layoutItemSchema>

export const BREAKPOINTS = { lg: 1200, md: 900, sm: 600, xs: 0 } as const
export const COLS = { lg: 12, md: 8, sm: 4, xs: 2 } as const
export type BreakpointKey = keyof typeof BREAKPOINTS

export const boardSchema = z.object({
  id,
  name: z.string().min(1).max(60),
  blocks: z.array(blockSchema).max(300).default([]),
  layouts: z
    .object({
      lg: z.array(layoutItemSchema).optional(),
      md: z.array(layoutItemSchema).optional(),
      sm: z.array(layoutItemSchema).optional(),
      xs: z.array(layoutItemSchema).optional(),
    })
    .default({}),
})
export type Board = z.infer<typeof boardSchema>

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const settingsSchema = z.object({
  title: z.string().max(60).default("Tidedeck"),
  theme: z.enum(["system", "dark", "light"]).default("dark"),
  accent: hex.default("#c9a45c"),
  background: z
    .object({
      imageUrl: z.string().max(4096).default(""),
      blur: z.number().min(0).max(40).default(0),
      dim: z.number().min(0).max(90).default(40),
    })
    .default({ imageUrl: "", blur: 0, dim: 40 }),
  cardOpacity: z.number().min(20).max(100).default(100),
  statusInterval: z.number().int().min(10).max(3600).default(30),
  requireLoginToView: z.boolean().default(false),
  customCss: z.string().max(50_000).default(""),
})
export type Settings = z.infer<typeof settingsSchema>

export const configSchema = z
  .object({
    version: z.literal(1).default(1),
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
  })
export type DashboardConfig = z.infer<typeof configSchema>

/** All apps across all boards, for search and status lookups. */
export function collectApps(cfg: DashboardConfig): App[] {
  const out: App[] = []
  for (const board of cfg.boards) {
    for (const block of board.blocks) {
      if (block.type === "app") out.push(block.props.app)
      else if (block.type === "apps") out.push(...block.props.apps)
    }
  }
  return out
}

export function findBlock(cfg: DashboardConfig, blockId: string): Block | undefined {
  for (const board of cfg.boards) {
    const hit = board.blocks.find((b) => b.id === blockId)
    if (hit) return hit
  }
  return undefined
}
