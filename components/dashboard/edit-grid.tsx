"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { GridLayout, calcGridItemPosition, useContainerWidth, type EventCallback, type Layout } from "react-grid-layout"
import { BlockFrame } from "@/components/dashboard/block-frame"
import { getDashboard, useDashboard } from "@/hooks/use-dashboard"
import { useScale } from "@/hooks/use-display"
import { setBlockZoom } from "@/lib/board-ops"
import { ZOOM_MAX, ZOOM_MIN } from "@/lib/display"
import { COLS } from "@/lib/model"
import type { Board, StoredLayoutItem } from "@/lib/schema"
import { makeFitCompactor, type Contact, type Gesture, type Homes } from "@/lib/fit-compactor"
import { GAP, ROW_H, breakpointFor, homesOf, layoutFor } from "@/lib/layout"
import { EmptyBoard, StaticBoard } from "@/components/dashboard/static-board"

// Rows and gaps (lib/layout.ts) scale with the dashboard size so layouts keep their
// proportions. The grid itself has no margins: every cell is padded by half a gap
// instead, so the steps can be as fine as 9 px while the space between blocks stays 14 px.

const strip = (layout: Layout, homes: Homes): StoredLayoutItem[] =>
  layout.map(({ i, x, y, w, h }) => {
    const home = homes.get(i)
    return {
      i,
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(w),
      h: Math.round(h),
      ...(home ? { hx: Math.round(home.x), hy: Math.round(home.y), hw: Math.round(home.w) } : {}),
    }
  })

/** Places by block, in a fixed order (the library may hand the same places over in another order). */
const placesKey = (items: readonly StoredLayoutItem[], withHomes: boolean) =>
  JSON.stringify(
    [...items]
      .sort((a, b) => (a.i < b.i ? -1 : a.i > b.i ? 1 : 0))
      .map((it) => (withHomes ? [it.i, it.x, it.y, it.w, it.h, it.hx, it.hy, it.hw] : [it.i, it.x, it.y, it.w, it.h])),
  )

/**
 * The board. Column width follows the screen (48 columns fill a wide screen),
 * and the board grows sideways the same way it grows downwards: while you
 * drag or resize past the right or left edge, new columns appear under the
 * mouse and the page itself gets wider (and scrolls along), no inner scrollbar.
 * On the left that means every block moves over by the new columns while the
 * page scrolls by the same amount, so nothing on screen jumps.
 */
export function EditGrid({ board }: { board: Board }) {
  const editing = useDashboard((s) => s.editing)
  const updateBoard = useDashboard((s) => s.updateBoard)
  const { width: roundedWidth, containerRef, mounted } = useContainerWidth({ initialWidth: 1280 })
  // The library rounds the width to whole pixels; the column width is worked out from the
  // exact one, like the shown board's CSS does, so the two place blocks identically.
  // (Picked during render, never a render behind the library's width: a stale width could
  // pick the wrong screen size for a moment, and that size's layout would be saved as this one's.)
  const [exactWidth, setExactWidth] = useState(0)
  useLayoutEffect(() => {
    setExactWidth(containerRef.current?.getBoundingClientRect().width ?? 0)
  }, [roundedWidth, mounted, containerRef])
  const viewWidth = Math.abs(exactWidth - roundedWidth) < 1 ? exactWidth : roundedWidth
  const boardRef = useRef<HTMLDivElement>(null)
  // Extra columns added live while a block is dragged/resized against the right edge.
  const [grow, setGrow] = useState(0)
  const lastGrow = useRef(0)
  // Columns added on the left during the current gesture, and scrolling still owed for them.
  const [lead, setLead] = useState(0)
  // Re-render on demand, so owed scrolling lands in the same frame as the layout change.
  const [, setTick] = useState(0)
  const leadRef = useRef(0)
  const owedScroll = useRef(0)
  const unusedLead = useRef(0)
  // Where in the block the pointer grabbed it, to tell when its left edge is pushed past the board.
  const grabDx = useRef(0)
  const grabW = useRef(0)
  // On touch screens a block only drags by its grip, so swiping elsewhere still scrolls the page.
  const [coarse, setCoarse] = useState(false)
  useEffect(() => setCoarse(window.matchMedia("(pointer: coarse)").matches), [])

  // The dashboard size scales rows and gaps; the screen-size class is picked in
  // scaled pixels, so a laptop at 150 % gets the tablet layout, like browser zoom.
  const scale = useScale()
  // Exact, not rounded: rounding adds up over hundreds of rows and would put blocks a
  // pixel or two off from where the shown board (CSS) draws them.
  const rowH = ROW_H * scale
  const gap = GAP * scale
  const bp = breakpointFor(viewWidth / scale)
  const setBreakpoint = useDashboard((s) => s.setBreakpoint)
  useEffect(() => {
    // Not before the width is measured (until then it is a stand-in).
    if (mounted) setBreakpoint(bp)
  }, [bp, mounted, setBreakpoint])
  const baseCols = COLS[bp]
  // Sideways growth is for mouse-driven desktops. On phones and touch screens a
  // board wider than the screen makes the browser zoom out, so it stays put.
  const canGrow = !coarse && bp !== "xs" && bp !== "sm"
  // The grid runs half a gap past the page edge on each side, so outer block edges line up with it.
  const colW = Math.max(20 * scale, (viewWidth + gap) / baseCols)

  // Layout for this screen size: stored, or derived from a wider one; missing blocks go to the bottom.
  const layout = useMemo<Layout>(() => layoutFor(board, bp), [board, bp])

  // Compaction that lets blocks fit next to big ones (see lib/fit-compactor.ts).
  const gesture = useRef<Gesture>(null)
  // Where the block being moved or resized touches others, drawn as lit edges (once per frame).
  const [contacts, setContacts] = useState<Contact[]>([])
  const nextContacts = useRef<Contact[]>([])
  const contactFrame = useRef<number | null>(null)
  const showContacts = (c: Contact[]) => {
    nextContacts.current = c
    if (contactFrame.current !== null) return
    contactFrame.current = requestAnimationFrame(() => {
      contactFrame.current = null
      const c = nextContacts.current
      setContacts((prev) => (JSON.stringify(prev) === JSON.stringify(c) ? prev : c))
    })
  }
  useEffect(() => () => void (contactFrame.current !== null && cancelAnimationFrame(contactFrame.current)), [])

  const visibleCols = useRef(baseCols)
  visibleCols.current = baseCols
  // Spots that pushed-away blocks return to (stored with this size's own layout).
  const storedHomes = useMemo(() => homesOf(board.layouts[bp]), [board, bp])
  const homesRef = useRef(storedHomes)
  homesRef.current = storedHomes
  const latestHomes = useRef<Homes>(storedHomes)
  const compactor = useMemo(
    () =>
      makeFitCompactor({
        gesture: () => gesture.current,
        limit: () => visibleCols.current + leadRef.current,
        lead: () => leadRef.current,
        trimmed: (n) => void (unusedLead.current = n),
        homes: () => homesRef.current,
        homesOut: (h) => void (latestHomes.current = h),
        contactsOut: (c) => showContacts(c),
      }),
    [],
  )
  const startGesture =
    (kind: "drag" | "resize"): EventCallback =>
    (current, oldItem, _n, _p, e, node) => {
      if (!oldItem) return
      const homes: Homes = new Map([...homesRef.current].map(([k, v]) => [k, { ...v }]))
      gesture.current = { kind, id: oldItem.i, start: current.map((it) => ({ ...it })), homes }
      unusedLead.current = 0
      if (kind === "drag" && e instanceof MouseEvent && node) {
        const r = node.getBoundingClientRect()
        grabDx.current = e.clientX - r.left
        grabW.current = r.width
      }
    }
  // The release is seen before the library's last layout pass, so that pass knows it is the last one.
  useEffect(() => {
    const done = () => {
      if (gesture.current) gesture.current.final = true
    }
    window.addEventListener("mouseup", done, true)
    window.addEventListener("touchend", done, true)
    return () => {
      window.removeEventListener("mouseup", done, true)
      window.removeEventListener("touchend", done, true)
    }
  }, [])

  const rightmost = layout.reduce((m, it) => Math.max(m, it.x + it.w), 0)
  // Exactly as wide as the blocks need (at least the screen); extra columns only
  // appear while a block is pushed past an edge, and go again when they stay empty.
  const cols = canGrow ? Math.max(baseCols, rightmost + lead) + grow : baseCols
  const gridWidth = cols * colW

  // Let the whole page be as wide as the board, so it scrolls like it does downwards.
  // (Before paint, and before the scrolling below, which needs the new width.)
  useLayoutEffect(() => {
    const el = boardRef.current
    // Not measured yet: the stand-in board looks after the page width.
    if (!el) return
    if (!board.blocks.length) {
      document.documentElement.style.removeProperty("--board-right")
      return
    }
    const right = el.getBoundingClientRect().left + window.scrollX + gridWidth - gap
    const box = containerRef.current?.getBoundingClientRect()
    // Only a board wider than its column widens the page (rounded down, so a board that
    // just fits never makes the page a pixel wider than the window).
    if (box && right > box.right + window.scrollX + 1) document.documentElement.style.setProperty("--board-right", `${Math.floor(right)}px`)
    else document.documentElement.style.removeProperty("--board-right")
  }, [gridWidth, board.blocks.length, viewWidth, mounted])
  // (A layout effect, so it runs before the next board sets its own width.)
  useLayoutEffect(
    () => () => {
      document.documentElement.style.removeProperty("--board-right")
    },
    [],
  )
  // Columns added or removed on the left: scroll by the same amount so nothing
  // moves on screen, then replay the pointer so the block catches up at once.
  useLayoutEffect(() => {
    const dx = owedScroll.current
    if (!dx) return
    owedScroll.current = 0
    window.scrollBy({ left: dx, behavior: "instant" })
    const p = pointer.current
    if (p && gesture.current) document.dispatchEvent(new MouseEvent("mousemove", { clientX: p.x, clientY: p.y, bubbles: true }))
  })

  /**
   * A block pushed past the right or left edge of the board makes room: more
   * columns appear there. Only pushing past the edge counts (the block's edge
   * would be outside the board), not merely touching it.
   */
  const edgeWork = (item: { x: number; w: number } | null | undefined, e: Event, node?: HTMLElement | null) => {
    if (e instanceof MouseEvent) pointer.current = { x: e.clientX, y: e.clientY }
    const g = gesture.current
    const p = pointer.current
    const board = boardRef.current?.getBoundingClientRect()
    const step = Math.max(2, Math.ceil(baseCols / 6))
    const ready = canGrow && item && g && p && board && performance.now() - lastGrow.current > 120
    const handle = node?.className ?? ""
    // Where the block's right and left edges would be if the board didn't stop them.
    const wantedRight =
      g?.kind === "drag" ? (p?.x ?? 0) - grabDx.current + grabW.current : /react-resizable-handle-(?:n|s)?e(?:\s|$)/.test(handle) ? (p?.x ?? 0) : null
    const wantedLeft = g?.kind === "drag" ? (p?.x ?? 0) - grabDx.current : /react-resizable-handle-(?:n|s)?w(?:\s|$)/.test(handle) ? (p?.x ?? 0) : null
    if (ready && item.x + item.w >= cols && wantedRight !== null && wantedRight > board.right + colW / 2) {
      lastGrow.current = performance.now()
      setGrow((n) => n + step)
    } else if (ready && item.x <= 0 && wantedLeft !== null) {
      if (wantedLeft < board.left - colW / 2) {
        lastGrow.current = performance.now()
        leadRef.current += step
        for (const it of g.start) it.x += step
        for (const home of g.homes.values()) home.x += step
        if (g.kind === "resize") g.shift = (g.shift ?? 0) + step
        owedScroll.current += step * colW
        setLead(leadRef.current)
      }
    }
    startAutoScroll()
  }

  // While dragging or resizing near the window edge, scroll the page smoothly and
  // replay the last mouse position so the block keeps following the pointer.
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const raf = useRef<number | null>(null)
  const startAutoScroll = () => {
    if (raf.current !== null) return
    let last = performance.now()
    const tick = (now: number) => {
      const p = pointer.current
      if (!p) return void (raf.current = null)
      const dt = Math.min(50, now - last) / 1000
      last = now
      // Speed depends on how deep the pointer is in the edge zone: up to 700 px/s.
      // Sideways the zone is narrow (inside the page margin), so working on a block
      // at the edge of the board doesn't scroll the page by accident.
      const speed = (d: number, edge: number) => (d < edge ? Math.round(((edge - Math.max(0, d)) / edge) * 700 * dt) : 0)
      const dx = speed(window.innerWidth - p.x, 28) - speed(p.x, 28)
      const dy = speed(window.innerHeight - p.y, 70) - speed(p.y, 70)
      if (dx || dy) {
        const before = [window.scrollX, window.scrollY]
        window.scrollBy(dx, dy)
        if (window.scrollX !== before[0] || window.scrollY !== before[1]) {
          document.dispatchEvent(new MouseEvent("mousemove", { clientX: p.x, clientY: p.y, bubbles: true }))
        }
      }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }
  const settle = () => {
    showContacts([])
    gesture.current = null
    pointer.current = null
    if (raf.current !== null) cancelAnimationFrame(raf.current)
    raf.current = null
    setGrow(0)
    // Empty columns on the left were taken out again: scroll back by as much.
    owedScroll.current -= unusedLead.current * colW
    if (owedScroll.current) setTick((t) => t + 1)
    leadRef.current = 0
    unusedLead.current = 0
    setLead(0)
  }

  const onLayoutChange = useCallback(
    (next: Layout) => {
      if (!editing) return
      const items = strip(next, latestHomes.current)
      const stored = board.layouts[bp]
      // Nothing changed: the same places (in any order) as stored, or, for a screen size
      // without its own layout yet, as the one made for it, which only becomes its own
      // once something is moved there.
      if (stored ? placesKey(items, true) === placesKey(stored, true) : placesKey(items, false) === placesKey(layout, false)) return
      updateBoard(board.id, (b) => void (b.layouts = { ...b.layouts, [bp]: items }))
    },
    [editing, board, bp, layout, updateBoard],
  )

  // While resizing, draw the block at the snapped size (exactly where the
  // placeholder is, minus the half gaps) instead of following the mouse pixel by pixel.
  const onResize: EventCallback = (_l, _o, newItem, placeholder, e, node) => {
    edgeWork(newItem, e, node)
    // The library hands over the resize handle; the grid item is its parent.
    const el = node?.closest<HTMLElement>(".react-grid-item")
    if (!placeholder || !el?.parentElement) return
    const pos = calcGridItemPosition(
      { margin: [0, 0], containerPadding: [0, 0], containerWidth: gridWidth, cols, rowHeight: rowH, maxRows: Infinity },
      placeholder.x,
      placeholder.y,
      placeholder.w,
      placeholder.h,
    )
    const item = el.getBoundingClientRect()
    const grid = el.parentElement.getBoundingClientRect()
    el.style.setProperty("--snap-x", `${pos.left - (item.left - grid.left) + gap / 2}px`)
    el.style.setProperty("--snap-y", `${pos.top - (item.top - grid.top) + gap / 2}px`)
    el.style.setProperty("--snap-w", `${Math.max(0, pos.width - gap)}px`)
    el.style.setProperty("--snap-h", `${Math.max(0, pos.height - gap)}px`)
  }

  const onDrag: EventCallback = (_l, _o, newItem, _p, e) => edgeWork(newItem, e)

  // Edit mode: Ctrl + scroll (or a trackpad pinch) over a block zooms its content.
  const pinch = useRef<{ id: string; z: number } | null>(null)
  useEffect(() => {
    const el = boardRef.current
    if (!el || !editing) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      const id = (e.target as Element).closest<HTMLElement>("[data-block-id]")?.dataset.blockId
      if (!id) return
      e.preventDefault()
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
      getDashboard().updateBlock(id, (b) => {
        const stored = b.zoom[bp] ?? 1
        // Pinches come in tiny steps: keep the unrounded value between events.
        const p = pinch.current
        const z = p && p.id === id && Math.abs(p.z - stored) < 0.01 ? p.z : stored
        let next: number
        if (Math.abs(dy) >= 50)
          next = Math.round((z + (dy < 0 ? 0.1 : -0.1)) * 10) / 10 // mouse wheel: 10 % steps
        else {
          next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * Math.exp(-dy * 0.01)))
          if ((z < 1 && next > 1) || (z > 1 && next < 1)) next = 1 // pause at 100 % on the way through
        }
        pinch.current = { id, z: next }
        setBlockZoom(b, bp, next)
      })
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [editing, bp])

  // Until the width is measured, show the board as it was (same places), not nothing.
  if (!mounted)
    return (
      <div ref={containerRef} className="w-full">
        <StaticBoard board={board} />
      </div>
    )

  return (
    <div ref={containerRef} className="w-full">
      <div className="pt-1 pb-8">
        <div
          ref={boardRef}
          className="deck-grid min-h-[60vh] rounded-[1.6rem_0.4rem_1rem_1rem]"
          data-editing={editing && board.blocks.length > 0}
          style={
            {
              width: board.blocks.length ? gridWidth - gap : "100%",
              "--col-w": `${colW}px`,
              "--gap": `${gap}px`,
              "--row-h": `${rowH}px`,
              "--pad": "0px",
            } as React.CSSProperties
          }
        >
          {board.blocks.length === 0 ? (
            <EmptyBoard editing={editing} />
          ) : (
            (
              <div style={{ width: gridWidth, margin: -gap / 2, position: "relative" }}>
                <GridLayout
                  // A new grid for each screen size: the library keeps its own copy of the
                  // layout, and one size's arrangement must never be reported as another's.
                  key={bp}
                  width={gridWidth}
                  layout={layout}
                  gridConfig={{ cols, rowHeight: rowH, margin: [0, 0], containerPadding: [0, 0] }}
                  dragConfig={{ enabled: editing, cancel: ".no-drag", threshold: 4, ...(coarse ? { handle: ".drag-grip" } : {}) }}
                  resizeConfig={{ enabled: editing, handles: ["se", "sw", "ne", "nw", "e", "w", "s", "n"] }}
                  compactor={compactor}
                  onLayoutChange={onLayoutChange}
                  onResize={onResize}
                  onDrag={onDrag}
                  onResizeStop={settle}
                  onDragStart={startGesture("drag")}
                  onResizeStart={startGesture("resize")}
                  onDragStop={settle}
                >
                  {board.blocks.map((block) => (
                    <div key={block.id} data-block-id={block.id}>
                      <div className="snap-frame h-full" style={{ "--bz": block.zoom[bp] ?? 1 } as React.CSSProperties}>
                        <BlockFrame block={block} boardId={board.id} />
                      </div>
                    </div>
                  ))}
                </GridLayout>
                {/* The edges where the moving block meets others, lit up in the gap between them. */}
                <div className="contact-layer" aria-hidden>
                  {contacts.map((c) =>
                    c.axis === "v" ? (
                      <span
                        key={`v${c.at}-${c.from}-${c.to}`}
                        className="contact contact-v"
                        style={{ left: c.at * colW, top: c.from * rowH + gap / 2, height: Math.max(0, (c.to - c.from) * rowH - gap) }}
                      />
                    ) : (
                      <span
                        key={`h${c.at}-${c.from}-${c.to}`}
                        className="contact contact-h"
                        style={{ top: c.at * rowH, left: c.from * colW + gap / 2, width: Math.max(0, (c.to - c.from) * colW - gap) }}
                      />
                    ),
                  )}
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
