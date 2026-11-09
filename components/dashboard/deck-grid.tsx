"use client"

import { useCallback, useMemo, useState } from "react"
import { Responsive, useContainerWidth, type Layout, type ResponsiveLayouts } from "react-grid-layout"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BlockFrame } from "@/components/dashboard/block-frame"
import { AddBlockMenu } from "@/components/dashboard/add-block-menu"
import { useDashboard } from "@/hooks/use-dashboard"
import { BREAKPOINTS, COLS, type Board, type BreakpointKey, type StoredLayoutItem } from "@/lib/schema"
import { metaFor } from "@/lib/widget-meta"

const ROW_H = 40
const GAP = 14
const KEYS = Object.keys(BREAKPOINTS) as BreakpointKey[]

const strip = (layout: Layout): StoredLayoutItem[] =>
  layout.map(({ i, x, y, w, h }) => ({ i, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }))

const breakpointFor = (width: number): BreakpointKey => KEYS.find((k) => width >= BREAKPOINTS[k]) ?? "xs"

export function DeckGrid({ board }: { board: Board }) {
  const editing = useDashboard((s) => s.editing)
  const updateBoard = useDashboard((s) => s.updateBoard)
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1280 })
  const [bp, setBp] = useState<BreakpointKey | null>(null)
  const current = bp ?? breakpointFor(width)

  // Stored layouts, with any block missing from a layout appended at the bottom.
  const layouts = useMemo(() => {
    const out: ResponsiveLayouts = {}
    for (const key of KEYS) {
      const stored = board.layouts[key]
      if (!stored) continue
      const have = new Set(stored.map((s) => s.i))
      let y = stored.reduce((m, s) => Math.max(m, s.y + s.h), 0)
      const items = stored
        .filter((s) => board.blocks.some((b) => b.id === s.i))
        .map((s) => {
          const { min } = metaFor(board.blocks.find((b) => b.id === s.i)!.type)
          return { ...s, minW: Math.min(min.w, COLS[key]), minH: min.h }
        })
      for (const b of board.blocks) {
        if (have.has(b.id)) continue
        const { size, min } = metaFor(b.type)
        items.push({ i: b.id, x: 0, y, w: Math.min(size.w, COLS[key]), h: size.h, minW: Math.min(min.w, COLS[key]), minH: min.h })
        y += size.h
      }
      out[key] = items
    }
    if (!out.lg) {
      let y = 0
      out.lg = board.blocks.map((b) => {
        const { size, min } = metaFor(b.type)
        const item = { i: b.id, x: 0, y, w: size.w, h: size.h, minW: min.w, minH: min.h }
        y += size.h
        return item
      })
    }
    return out
  }, [board])

  const onLayoutChange = useCallback(
    (_layout: Layout, all: ResponsiveLayouts) => {
      if (!editing) return
      const next: Board["layouts"] = {}
      for (const key of KEYS) if (all[key]) next[key] = strip(all[key]!)
      // Only persist breakpoints that were stored before or that you just edited.
      const keep = Object.fromEntries(
        Object.entries(next).filter(([k]) => board.layouts[k as BreakpointKey] || k === current),
      ) as Board["layouts"]
      const before = JSON.stringify(KEYS.map((k) => board.layouts[k] ?? null))
      const after = JSON.stringify(KEYS.map((k) => keep[k] ?? null))
      if (before !== after) updateBoard(board.id, (b) => void (b.layouts = keep))
    },
    [editing, board, current, updateBoard],
  )

  const cols = COLS[current]
  const colW = (width - GAP * (cols - 1)) / cols

  return (
    <div
      ref={containerRef}
      className="deck-grid min-h-[60vh]"
      data-editing={editing}
      style={
        {
          "--col-w": `${colW}px`,
          "--gap": `${GAP}px`,
          "--row-h": `${ROW_H}px`,
          "--pad": "0px",
        } as React.CSSProperties
      }
    >
      {board.blocks.length === 0 ? (
        <EmptyBoard editing={editing} />
      ) : (
        mounted && (
          <Responsive
            width={width}
            layouts={layouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={ROW_H}
            margin={[GAP, GAP]}
            containerPadding={[0, 0]}
            dragConfig={{ enabled: editing, cancel: ".no-drag", threshold: 4 }}
            resizeConfig={{ enabled: editing, handles: ["se", "sw", "ne", "nw", "e", "w", "s", "n"] }}
            onBreakpointChange={(b) => setBp(b as BreakpointKey)}
            onLayoutChange={onLayoutChange}
          >
            {board.blocks.map((block) => (
              <div key={block.id} data-block-id={block.id}>
                <BlockFrame block={block} boardId={board.id} />
              </div>
            ))}
          </Responsive>
        )
      )}
    </div>
  )
}

function EmptyBoard({ editing }: { editing: boolean }) {
  const requestEdit = useDashboard((s) => s.requestEdit)
  return (
    <div className="grid min-h-[50vh] place-items-center text-center">
      <div className="max-w-sm">
        <p className="font-display text-xl font-semibold">This board is empty</p>
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
