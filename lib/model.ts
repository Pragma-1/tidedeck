/**
 * Plain data helpers and constants shared by the page, the editor and the
 * server. Nothing here pulls in the validation library, so the dashboard can
 * use it without loading the schema code (which is only needed for saving).
 */
import type { App, Block, DashboardConfig } from "@/lib/schema"

/** Screen-size classes by width (in px at 1×), widest first. */
export const BREAKPOINTS = { lg: 1200, md: 900, sm: 600, xs: 0 } as const
export type BreakpointKey = keyof typeof BREAKPOINTS
export const BREAKPOINT_KEYS = Object.keys(BREAKPOINTS) as BreakpointKey[]

/** Grid v3: 48 columns on wide screens and 9 px rows (at 1×), gaps drawn inside the cells. */
export const COLS = { lg: 48, md: 32, sm: 16, xs: 8 } as const

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
