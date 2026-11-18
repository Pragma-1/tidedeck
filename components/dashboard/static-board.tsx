"use client"

import { useLayoutEffect, useMemo, useRef } from "react"
import dynamic from "next/dynamic"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BlockFrame } from "@/components/dashboard/block-frame"
import { useDashboard } from "@/hooks/use-dashboard"
import { resolvedLayout, type GridItem } from "@/lib/layout"
import { BREAKPOINT_KEYS, COLS, type BreakpointKey } from "@/lib/model"
import type { Board } from "@/lib/schema"
import { loadPart } from "@/lib/stale-build"

// Only needed on an empty board while editing.
const AddBlockMenu = dynamic(
  loadPart(() => import("@/components/dashboard/add-block-menu").then((m) => m.AddBlockMenu), { resumeEdit: true }),
  { ssr: false },
)

type Placed = Record<BreakpointKey, GridItem | undefined>
type Placement = { byId: Map<string, Placed>; cols: Record<BreakpointKey, number>; rows: Record<BreakpointKey, number> }

// Placement depends only on the layouts and which blocks there are, so it is kept by
// those: the server works it out once per saved change, not for every page view.
const placements = new Map<string, Placement>()

/** Every block's place on every screen size, and how many columns each size needs. */
function placement(board: Board): Placement {
  const key = JSON.stringify([board.layouts, board.blocks.map((b) => [b.id, b.type])])
  let hit = placements.get(key)
  if (hit) return hit
  hit = computePlacement(board)
  placements.set(key, hit)
  if (placements.size > 32) placements.delete(placements.keys().next().value!)
  return hit
}

function computePlacement(board: Board): Placement {
  const byId = new Map<string, Placed>()
  const cols = {} as Record<BreakpointKey, number>
  const rows = {} as Record<BreakpointKey, number>
  for (const bp of BREAKPOINT_KEYS) {
    const items = resolvedLayout(board, bp)
    rows[bp] = items.reduce((m, it) => Math.max(m, it.y + it.h), 0)
    // Wide screens can grow sideways (like the editor); tablets and phones keep the screen width.
    const right = items.reduce((m, it) => Math.max(m, it.x + it.w), 0)
    cols[bp] = bp === "lg" || bp === "md" ? Math.max(COLS[bp], right) : COLS[bp]
    for (const it of items) {
      const p = byId.get(it.i) ?? ({} as Placed)
      p[bp] = it
      byId.set(it.i, p)
    }
  }
  return { byId, cols, rows }
}

function StaticGrid({ board, placed }: { board: Board; placed: Placement }) {
  return (
    <div className="static-grid">
      {board.blocks.map((block) => {
        const p = placed.byId.get(block.id)
        const vars: Record<string, string | number> = {}
        for (const bp of BREAKPOINT_KEYS) {
          const it = p?.[bp]
          if (!it) continue
          vars[`--x-${bp}`] = it.x
          vars[`--y-${bp}`] = it.y
          vars[`--w-${bp}`] = it.w
          vars[`--h-${bp}`] = it.h
          const z = block.zoom[bp]
          if (z !== undefined && z !== 1) vars[`--z-${bp}`] = z
        }
        return (
          <div key={block.id} data-block-id={block.id} className="static-item" style={vars as React.CSSProperties}>
            <BlockFrame block={block} boardId={board.id} />
          </div>
        )
      })}
    </div>
  )
}

/**
 * The board as it is shown (not edited): plain CSS, rendered on the
 * server, so it appears with the page instead of after the scripts. The layout
 * for each screen size is in custom properties; container queries pick the one
 * that applies, with the same thresholds and column widths the editor uses
 * (see .static-board in globals.css). Nothing is measured before it shows,
 * nothing moves after loading.
 *
 * After loading it tells the store which screen size the CSS picked (other
 * parts use it, e.g. for module zoom) and makes the page as wide as the board
 * when the board is wider than the window.
 */
export function StaticBoard({ board }: { board: Board }) {
  const placed = useMemo(() => placement(board), [board])
  const editing = useDashboard((s) => s.editing)
  const setBreakpoint = useDashboard((s) => s.setBreakpoint)
  const boxRef = useRef<HTMLDivElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const box = boxRef.current
    const el = boardRef.current
    if (!box || !el) return
    const root = document.documentElement
    const sync = () => {
      // The screen size the container queries chose (exactly what's on screen).
      const bp = getComputedStyle(el).getPropertyValue("--bp").trim()
      if ((BREAKPOINT_KEYS as string[]).includes(bp)) setBreakpoint(bp as BreakpointKey)
      const right = el.getBoundingClientRect().right + window.scrollX
      // Only a board wider than its column widens the page (rounded down, so a board that
      // just fits never makes the page a pixel wider than the window). On touch screens it
      // scrolls within itself instead (see .board-box in globals.css).
      const touch = window.matchMedia("(pointer: coarse)").matches
      if (board.blocks.length && !touch && right > box.getBoundingClientRect().right + window.scrollX + 1) root.style.setProperty("--board-right", `${Math.floor(right)}px`)
      else root.style.removeProperty("--board-right")
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(box)
    ro.observe(el)
    window.addEventListener("td-display", sync)
    return () => {
      ro.disconnect()
      window.removeEventListener("td-display", sync)
    }
  }, [board.blocks.length, setBreakpoint])
  useLayoutEffect(
    () => () => {
      document.documentElement.style.removeProperty("--board-right")
    },
    [],
  )

  return (
    <div ref={boxRef} className="board-box w-full">
      <div className="pt-1 pb-8">
        <div
          ref={boardRef}
          className="deck-grid static-board min-h-[60vh] rounded-[1.6rem_0.4rem_1rem_1rem]"
          data-editing={editing && board.blocks.length > 0}
          data-empty={board.blocks.length === 0 || undefined}
          style={Object.fromEntries(BREAKPOINT_KEYS.flatMap((bp) => [[`--cols-${bp}`, placed.cols[bp]], [`--rows-${bp}`, placed.rows[bp]]])) as React.CSSProperties}
        >
          {board.blocks.length === 0 ? <EmptyBoard editing={editing} /> : <StaticGrid board={board} placed={placed} />}
        </div>
      </div>
    </div>
  )
}

export function EmptyBoard({ editing }: { editing: boolean }) {
  const requestEdit = useDashboard((s) => s.requestEdit)
  return (
    <div className="block-surface grid min-h-[50vh] place-items-center rounded-[1.6rem_0.4rem_1rem_1rem] p-8 text-center">
      <div className="max-w-sm">
        <p className="text-xl font-[650] tracking-[-0.01em]">This board is empty</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {editing ? "Add apps, links and widgets, then drag them where you want." : "Switch to editing to add apps, links and widgets."}
        </p>
        <div className="mt-5 flex justify-center">
          {editing ? (
            <AddBlockMenu>
              <Button>
                <Plus /> Add block
              </Button>
            </AddBlockMenu>
          ) : (
            <Button variant="outline" onClick={() => requestEdit(true)}>
              Edit dashboard
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
