import { BREAKPOINTS, COLS, type Block, type Board, type BreakpointKey, type StoredLayoutItem } from "@/lib/schema"
import { metaFor } from "@/lib/widget-meta"
import { uid } from "@/lib/utils"

const KEYS = Object.keys(BREAKPOINTS) as BreakpointKey[]

const bottom = (layout: StoredLayoutItem[]) => layout.reduce((m, it) => Math.max(m, it.y + it.h), 0)

/** Adds a block at the bottom of every stored breakpoint layout. */
export function addBlock(board: Board, block: Block, near?: StoredLayoutItem) {
  const { size } = metaFor(block.type)
  board.blocks.push(block)
  if (!board.layouts.lg) board.layouts.lg = []
  for (const key of KEYS) {
    const layout = board.layouts[key]
    if (!layout) continue
    const w = Math.min(near?.w ?? size.w, COLS[key])
    layout.push({ i: block.id, x: 0, y: bottom(layout), w, h: near?.h ?? size.h })
  }
}

export function removeBlock(board: Board, blockId: string) {
  board.blocks = board.blocks.filter((b) => b.id !== blockId)
  for (const key of KEYS) {
    const layout = board.layouts[key]
    if (layout) board.layouts[key] = layout.filter((it) => it.i !== blockId)
  }
}

export function duplicateBlock(board: Board, blockId: string): string | null {
  const source = board.blocks.find((b) => b.id === blockId)
  if (!source) return null
  const copy = structuredClone(source)
  copy.id = uid()
  if (copy.type === "app") copy.props.app.id = uid()
  if (copy.type === "apps") copy.props.apps.forEach((a) => (a.id = uid()))
  const near = board.layouts.lg?.find((it) => it.i === blockId)
  addBlock(board, copy, near)
  return copy.id
}
