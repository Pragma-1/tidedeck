import type { BlockType } from "@/lib/schema"

/**
 * Name, default size and smallest size of each block type (grid units). Plain
 * data, so the board can lay blocks out without loading the editor's menus.
 */
export type BlockInfo = { label: string; size: { w: number; h: number }; min: { w: number; h: number } }

export const BLOCK_INFO: Record<BlockType, BlockInfo> = {
  app: { label: "App", size: { w: 8, h: 12 }, min: { w: 4, h: 12 } },
  apps: { label: "App group", size: { w: 16, h: 30 }, min: { w: 8, h: 18 } },
  search: { label: "Search", size: { w: 24, h: 12 }, min: { w: 8, h: 12 } },
  clock: { label: "Clock", size: { w: 12, h: 12 }, min: { w: 8, h: 12 } },
  weather: { label: "Weather", size: { w: 12, h: 30 }, min: { w: 8, h: 18 } },
  system: { label: "Server resources", size: { w: 12, h: 30 }, min: { w: 8, h: 18 } },
  rss: { label: "RSS feed", size: { w: 16, h: 36 }, min: { w: 8, h: 18 } },
  notes: { label: "Notes", size: { w: 12, h: 24 }, min: { w: 8, h: 12 } },
  checklist: { label: "Checklist", size: { w: 12, h: 30 }, min: { w: 8, h: 12 } },
  music: { label: "Music", size: { w: 16, h: 54 }, min: { w: 12, h: 18 } },
  calendar: { label: "Calendar", size: { w: 12, h: 36 }, min: { w: 8, h: 30 } },
  iframe: { label: "Embedded page", size: { w: 24, h: 48 }, min: { w: 8, h: 18 } },
}

export const infoFor = (type: BlockType): BlockInfo => BLOCK_INFO[type]
