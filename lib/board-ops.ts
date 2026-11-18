import { BREAKPOINTS, COLS } from "@/lib/model"
import { blockSchema, type Block, type Board, type BreakpointKey, type DashboardConfig, type StoredLayoutItem } from "@/lib/schema"
import { infoFor } from "@/lib/block-info"
import { uid } from "@/lib/utils"
import { clampZoom } from "@/lib/display"

const KEYS = Object.keys(BREAKPOINTS) as BreakpointKey[]

const bottom = (layout: StoredLayoutItem[]) => layout.reduce((m, it) => Math.max(m, it.y + it.h), 0)

/** Adds a block at the bottom of every stored breakpoint layout. */
export function addBlock(board: Board, block: Block, near?: StoredLayoutItem) {
  const { size } = infoFor(block.type)
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
  const copy = cloneBlock(source)
  const near = board.layouts.lg?.find((it) => it.i === blockId)
  addBlock(board, copy, near)
  return copy.id
}

/** Sets a block's content zoom for one screen size; 100 % is stored as "not set". */
export function setBlockZoom(block: Block, bp: BreakpointKey, zoom: number) {
  const z = clampZoom(zoom)
  if (Math.abs(z - 1) < 0.005) delete block.zoom[bp]
  else block.zoom[bp] = z
}

// ---------------------------------------------------------------------------
// Copying and moving blocks and apps between boards.

export type SendMode = "copy" | "move"

/** Limits from the schema: a board holds up to 300 blocks, an app group up to 200 apps. */
export const MAX_BLOCKS = 300
export const MAX_APPS = 200

/** A fresh copy: new ids for the block and every app in it (status and order are per id). */
function cloneBlock(block: Block): Block {
  const copy = structuredClone(block)
  copy.id = uid()
  if (copy.type === "app") copy.props.app.id = uid()
  if (copy.type === "apps") copy.props.apps.forEach((a) => (a.id = uid()))
  return copy
}

/**
 * Copies or moves a block to another board, where it goes to the bottom with the
 * size it has here. A moved block keeps its id, so a connected music player stays
 * connected; a copy is new. Returns the block's id on the target board, or an
 * error message.
 */
export function sendBlock(cfg: DashboardConfig, fromBoardId: string, blockId: string, toBoardId: string, mode: SendMode): { id: string } | { error: string } {
  const from = cfg.boards.find((b) => b.id === fromBoardId)
  const to = cfg.boards.find((b) => b.id === toBoardId)
  const source = from?.blocks.find((b) => b.id === blockId)
  if (!from || !to || !source) return { error: "That block or board doesn't exist anymore." }
  if (from === to) return { error: "The block is already on this board." }
  if (to.blocks.length >= MAX_BLOCKS) return { error: `“${to.name}” is full (${MAX_BLOCKS} blocks).` }
  const near = from.layouts.lg?.find((it) => it.i === blockId)
  const block = mode === "move" ? source : cloneBlock(source)
  if (mode === "move") removeBlock(from, blockId)
  addBlock(to, block, near && { i: block.id, x: 0, y: 0, w: near.w, h: near.h })
  return { id: block.id }
}

/** Where an app goes: into an app group, or as a block of its own (groupId omitted). */
export type AppTarget = { boardId: string; groupId?: string }

/**
 * Copies or moves one app (from an app block or an app group) to an app group
 * or into a new app block on any board. Moving the only app of an app block
 * moves the block itself.
 */
export function sendApp(cfg: DashboardConfig, fromBlockId: string, appId: string, target: AppTarget, mode: SendMode): { error: string } | { ok: true } {
  let fromBoard: Board | undefined
  let fromBlock: Block | undefined
  for (const b of cfg.boards) {
    const hit = b.blocks.find((x) => x.id === fromBlockId)
    if (hit) [fromBoard, fromBlock] = [b, hit]
  }
  const toBoard = cfg.boards.find((b) => b.id === target.boardId)
  if (!fromBoard || !fromBlock || !toBoard) return { error: "That app or board doesn't exist anymore." }
  const app =
    fromBlock.type === "app" && fromBlock.props.app.id === appId
      ? fromBlock.props.app
      : fromBlock.type === "apps"
        ? fromBlock.props.apps.find((a) => a.id === appId)
        : undefined
  if (!app) return { error: "That app doesn't exist anymore." }

  if (target.groupId) {
    const group = toBoard.blocks.find((b) => b.id === target.groupId)
    if (!group || group.type !== "apps") return { error: "That app group doesn't exist anymore." }
    if (group === fromBlock) return { error: "The app is already in this group." }
    if (group.props.apps.length >= MAX_APPS) return { error: `“${group.title || "That group"}” is full (${MAX_APPS} apps).` }
    group.props.apps.push({ ...structuredClone(app), id: mode === "move" ? app.id : uid() })
  } else {
    if (mode === "move" && fromBlock.type === "app") {
      if (fromBoard === toBoard) return { error: "The app is already a block on this board." }
      const sent = sendBlock(cfg, fromBoard.id, fromBlock.id, toBoard.id, "move")
      return "error" in sent ? sent : { ok: true }
    }
    if (toBoard.blocks.length >= MAX_BLOCKS) return { error: `“${toBoard.name}” is full (${MAX_BLOCKS} blocks).` }
    const block = blockSchema.parse({ id: uid(), type: "app", title: "", showTitle: false, props: { app: { ...structuredClone(app), id: mode === "move" ? app.id : uid() } } })
    addBlock(toBoard, block)
  }

  if (mode === "move") {
    if (fromBlock.type === "app") removeBlock(fromBoard, fromBlock.id)
    else if (fromBlock.type === "apps") fromBlock.props.apps = fromBlock.props.apps.filter((a) => a.id !== appId)
  }
  return { ok: true }
}

/** A new, empty board at the end; returns its id. */
export function addBoard(cfg: DashboardConfig, name: string): string {
  const id = uid()
  cfg.boards.push({ id, name: name.slice(0, 60) || "Board", blocks: [], layouts: {} })
  return id
}
