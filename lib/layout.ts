/**
 * Where every block of a board goes on each screen size. Shared by the board as
 * shown (rendered on the server, no layout library) and the editor, so both
 * place blocks exactly alike.
 */
import { infoFor } from "@/lib/block-info"
import { deriveLayout } from "@/lib/derive-layout"
import { restore, settle, type Homes } from "@/lib/fit-compactor"
import { BREAKPOINT_KEYS, BREAKPOINTS, COLS, type BreakpointKey } from "@/lib/model"
import type { BlockType, Board, StoredLayoutItem } from "@/lib/schema"

/** At 1× (16 px root); both scale with the dashboard size, as rem. */
export const ROW_H = 9
export const GAP = 14

/** Screen-size class for a board width in px at 1× (the width divided by the scale). */
export const breakpointFor = (width: number): BreakpointKey => BREAKPOINT_KEYS.find((k) => width >= BREAKPOINTS[k]) ?? "xs"

export type GridItem = { i: string; x: number; y: number; w: number; h: number; minW: number; minH: number }

/**
 * The layout for one screen size: its own stored layout, or one derived from
 * the nearest wider arranged size (from the widest narrower one if there is no
 * wider); blocks missing from it go to the bottom.
 */
export function layoutFor(board: Board, bp: BreakpointKey): GridItem[] {
  const cols = COLS[bp]
  let base: StoredLayoutItem[] = []
  const own = board.layouts[bp]
  if (own) base = own
  else {
    const idx = BREAKPOINT_KEYS.indexOf(bp)
    const wider = BREAKPOINT_KEYS.slice(0, idx)
      .reverse()
      .find((k) => board.layouts[k])
    const from = wider ?? BREAKPOINT_KEYS.slice(idx + 1).find((k) => board.layouts[k])
    if (from) base = deriveLayout(board.layouts[from]!, COLS[from], cols)
  }
  const types = new Map(board.blocks.map((b) => [b.id, b.type]))
  const zooms = new Map(board.blocks.map((b) => [b.id, b.zoom[bp] ?? 1]))
  // One place per block (the first, should a layout ever list a block twice).
  const have = new Set<string>()
  const items = base.filter((it) => types.has(it.i) && !have.has(it.i) && have.add(it.i))
  let y = items.reduce((m, it) => Math.max(m, it.y + it.h), 0)
  for (const b of board.blocks) {
    if (have.has(b.id)) continue
    const { size } = infoFor(b.type)
    items.push({ i: b.id, x: 0, y, w: Math.min(size.w, cols), h: size.h })
    y += size.h
  }
  // Tablets and phones keep the screen width: like the editor's grid, a block that
  // doesn't fit moves in from the right edge, and one wider than the screen gets its width.
  const fixed = bp === "sm" || bp === "xs"
  return items.map(({ i, x, y, w, h }) => {
    const { minW, minH } = minSize(types.get(i)!, zooms.get(i) ?? 1, cols)
    if (fixed && x + w > cols) x = cols - w
    if (fixed && x < 0) [x, w] = [0, cols]
    return { i, x, y, w, h, minW, minH }
  })
}

/**
 * The smallest a block may be made. A zoomed-out block's content is smaller, so it
 * may be made smaller too (and a zoomed-in one needs more room).
 */
export function minSize(type: BlockType, zoom: number, cols: number): { minW: number; minH: number } {
  const { min } = infoFor(type)
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return {
    minW: Math.max(1, Math.min(cols, Math.ceil(min.w * z))),
    minH: Math.max(1, Math.ceil(min.h * z)),
  }
}

/** Spots that pushed-away blocks return to, as stored with a size's own layout. */
export const homesOf = (items: StoredLayoutItem[] | undefined): Homes =>
  new Map(
    (items ?? []).flatMap((it) => (it.hx !== undefined && it.hy !== undefined && it.hw !== undefined ? [[it.i, { x: it.hx, y: it.hy, w: it.hw }] as const] : [])),
  )

/**
 * The layout as the editor would show it after loading: overlaps resolved and
 * pushed-away blocks back in their spot where there is room (see fit-compactor).
 */
export function resolvedLayout(board: Board, bp: BreakpointKey): GridItem[] {
  const items = settle(layoutFor(board, bp)) as GridItem[]
  restore(items, new Map([...homesOf(board.layouts[bp])].map(([k, v]) => [k, { ...v }])))
  return items
}
