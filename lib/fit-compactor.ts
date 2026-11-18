import type { Compactor, Layout, LayoutItem } from "react-grid-layout"

/**
 * The drag or resize in progress, with every block's position when it started.
 * `shift`: columns added on the left that the block being resized hasn't moved
 * along with yet. `final`: the pointer was released, this is the last pass.
 */
export type Gesture = {
  kind: "drag" | "resize"
  id: string
  start: LayoutItem[]
  /** Spots blocks had before something pushed them away, as when the gesture began. */
  homes: Homes
  shift?: number
  final?: boolean
} | null

/** Where a block was (and how wide) before another one made it move or shrink. */
export type Home = { x: number; y: number; w: number }
export type Homes = Map<string, Home>

export type FitContext = {
  gesture: () => Gesture
  /** Right edge of the visible board, in columns. */
  limit: () => number
  /** Columns added on the left during this gesture. */
  lead: () => number
  /** Called on the last pass with how many of those columns went unused and were removed again. */
  trimmed: (cols: number) => void
  /** Home spots outside a gesture (the stored ones). */
  homes: () => Homes
  /** Receives the home spots belonging to the layout just returned. */
  homesOut: (homes: Homes) => void
  /** Receives where the block being moved or resized touches others (empty when idle). */
  contactsOut?: (contacts: Contact[]) => void
}

/**
 * A stretch of edge where two blocks meet: `axis` "v" is a vertical edge at
 * column line `at`, "h" a horizontal one at row line `at`; `from`–`to` is the
 * shared part along it (rows for "v", columns for "h").
 */
export type Contact = { axis: "v" | "h"; at: number; from: number; to: number }

/** Every edge stretch where `me` touches another block. */
export function contactsOf(me: LayoutItem, items: readonly LayoutItem[]): Contact[] {
  const out: Contact[] = []
  for (const o of items) {
    if (o.i === me.i) continue
    const y0 = Math.max(me.y, o.y)
    const y1 = Math.min(me.y + me.h, o.y + o.h)
    const x0 = Math.max(me.x, o.x)
    const x1 = Math.min(me.x + me.w, o.x + o.w)
    if (y1 > y0 && (me.x + me.w === o.x || o.x + o.w === me.x)) out.push({ axis: "v", at: me.x + me.w === o.x ? o.x : me.x, from: y0, to: y1 })
    if (x1 > x0 && (me.y + me.h === o.y || o.y + o.h === me.y)) out.push({ axis: "h", at: me.y + me.h === o.y ? o.y : me.y, from: x0, to: x1 })
  }
  return out
}

/**
 * Blocks that were pushed away go back to their spot (and width) once it is
 * free again; if it isn't completely free, as close to it as there is room.
 * The block being moved or resized right now (`pinned`) is never in the way
 * of that and never moves.
 */
export function restore(items: LayoutItem[], homes: Homes, pinned?: string): void {
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    const order = items.filter((it) => it.i !== pinned && homes.has(it.i)).sort((a, b) => homes.get(a.i)!.y - homes.get(b.i)!.y || homes.get(a.i)!.x - homes.get(b.i)!.x)
    for (const it of order) {
      const home = homes.get(it.i)!
      const free = (r: LayoutItem) => !items.some((o) => o !== it && overlap(o, r))
      const back = { ...it, x: home.x, y: home.y, w: home.w }
      if (free(back)) {
        if (it.x !== back.x || it.y !== back.y || it.w !== back.w) changed = true
        Object.assign(it, { x: back.x, y: back.y, w: back.w })
        homes.delete(it.i)
        continue
      }
      // Partly: up towards the home row (the highest free row between there and here).
      // The first free row is the home row itself or right below another block, so only
      // those rows are tried (not every row in between, which could be thousands).
      if (home.y < it.y) {
        const rows = [home.y, ...items.map((o) => o.y + o.h).filter((y) => y > home.y && y < it.y)].sort((a, b) => a - b)
        const y = rows.find((r) => free({ ...it, y: r }))
        if (y !== undefined) {
          it.y = y
          changed = true
        }
      }
      // …and, once on that row, wider again towards the home width, up to the nearest
      // block on either side.
      if (it.y === home.y) {
        const band = items.filter((o) => o !== it && o.y < it.y + it.h && it.y < o.y + o.h)
        const x = Math.min(it.x, Math.max(home.x, ...band.filter((o) => o.x + o.w <= it.x).map((o) => o.x + o.w)))
        const right = Math.min(home.x + home.w, x + home.w, ...band.filter((o) => o.x >= it.x + it.w).map((o) => o.x))
        const w = Math.max(it.x + it.w - x, right - x)
        if (x !== it.x || w !== it.w) {
          it.x = x
          it.w = w
          changed = true
        }
        if (it.x === home.x && it.w === home.w) homes.delete(it.i)
      }
    }
    if (!changed) break
  }
}

const overlap = (a: LayoutItem, b: LayoutItem) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const clone = (it: LayoutItem): LayoutItem => ({ ...it })

/**
 * Removes overlaps without any gravity: `first` stays exactly where it is, every
 * other block keeps its place unless it overlaps something, and then moves down
 * just far enough (which may push the next one, and so on). Gaps stay gaps.
 */
export function settle(items: readonly LayoutItem[], first?: string): LayoutItem[] {
  const pinned = items.filter((it) => it.i === first)
  const rest = items.filter((it) => it.i !== first).sort((a, b) => a.y - b.y || a.x - b.x)
  const placed: LayoutItem[] = pinned.map(clone)
  for (const it of rest) {
    const next = clone(it)
    for (let hit = placed.find((p) => overlap(p, next)); hit; hit = placed.find((p) => overlap(p, next))) {
      next.y = Math.max(...placed.filter((p) => overlap(p, next)).map((p) => p.y + p.h))
    }
    placed.push(next)
  }
  return placed
}

/**
 * Free placement for the board. Blocks stay exactly where they are put, with
 * empty space above or between them if you like; nothing floats up to the next
 * block. Only overlaps are resolved:
 *
 * - Dropping onto other blocks moves those down out of the way.
 * - Dragging into a gap narrower than the block makes the block fit the gap
 *   (down to its minimum width) instead of pushing the neighbours away.
 * - Making a block wider narrows the blocks beside it (down to their minimum)
 *   instead of sending them underneath.
 * - A block whose middle is inside the visible board (`limit` columns) stays
 *   inside it; dragging its middle past the right edge makes the board wider.
 * - Columns added on the left while a block is pushed past the left edge are
 *   removed again at the end if nothing ended up in them; so are empty columns
 *   on the left of a board that is wider than the screen.
 * - Blocks that had to make way remember where they were and go back there as
 *   soon as there is room again (shrink the big block back and they return).
 *   A block you move or resize yourself forgets that; so does one whose spot
 *   you drop another block onto.
 */
export function makeFitCompactor({ gesture, limit, lead, trimmed, homes, homesOut, contactsOut }: FitContext): Compactor {
  const drag = (layout: Layout, g: NonNullable<Gesture>, cols: number): LayoutItem[] | null => {
    const d = layout.find((it) => it.i === g.id)
    const orig = g.start.find((it) => it.i === g.id)
    if (!d || !orig) return null
    // Everyone else where they were when the drag began.
    const base = g.start.filter((it) => it.i !== g.id).map(clone)
    const moved: LayoutItem = { ...d, w: Math.min(orig.w, cols), h: orig.h }
    const center = Math.max(0, Math.min(cols - 1, Math.floor(moved.x + moved.w / 2)))
    const right = center < limit() ? Math.min(cols, limit()) : cols
    if (moved.x + moved.w > right) moved.x = Math.max(0, right - moved.w)
    const hits = (r: LayoutItem) => base.some((o) => overlap(o, r))
    if (!hits(moved)) return [...base, moved]

    // Over a gap: take the run of free columns under the block's middle.
    const lo = moved.y
    const hi = moved.y + moved.h
    const busy = (c: number) => base.some((o) => o.x <= c && c < o.x + o.w && o.y < hi && lo < o.y + o.h)
    const mid = Math.max(0, Math.min(right - 1, Math.floor(moved.x + moved.w / 2)))
    if (!busy(mid)) {
      let a = mid
      let b = mid + 1
      while (a > 0 && !busy(a - 1)) a--
      while (b < right && !busy(b)) b++
      const w = Math.min(moved.w, b - a)
      if (w >= Math.max(1, orig.minW ?? d.minW ?? 1)) {
        const fitted: LayoutItem = { ...moved, w, x: Math.min(Math.max(moved.x, a), b - w) }
        if (!hits(fitted)) return [...base, fitted]
      }
    }
    // Onto other blocks: they make way downwards.
    return settle([...base, moved], moved.i)
  }

  const resize = (layout: Layout, g: NonNullable<Gesture>): LayoutItem[] | null => {
    const found = layout.find((it) => it.i === g.id)
    const r0 = g.start.find((it) => it.i === g.id)
    if (!found || !r0) return null
    const r = { ...found }
    if (g.shift) {
      // The board grew on the left: the library still has this block where it was.
      r.x += g.shift
      g.shift = 0
    }
    const others = g.start.filter((it) => it.i !== g.id).map(clone)
    for (const o of others) {
      if (!overlap(o, r)) continue
      const min = Math.max(1, o.minW ?? 1)
      if (o.x >= r0.x + r0.w) {
        // was to the right: give up columns on its left side
        const ov = r.x + r.w - o.x
        if (o.w - ov >= min) {
          o.x += ov
          o.w -= ov
        }
      } else if (o.x + o.w <= r0.x) {
        // was to the left: give up columns on its right side
        const ov = o.x + o.w - r.x
        if (o.w - ov >= min) o.w -= ov
      }
    }
    // Whatever is still in the way (blocks below, or too narrow to give way) moves down.
    return settle([...others, r], r.i)
  }

  return {
    type: null,
    // react-grid-layout's own collision handling would move the dragged block
    // itself (it swaps it with whatever it touches); this compactor resolves
    // overlaps on its own, so the block stays under the pointer.
    allowOverlap: true,
    compact(layout, cols) {
      const g = gesture()
      const result = g ? (g.kind === "drag" ? drag(layout, g, cols) : resize(layout, g)) : null
      const out = result ?? settle(layout)
      const H: Homes = new Map([...(g ? g.homes : homes())].map(([k, v]) => [k, { ...v }]))
      // Blocks that just had to make way remember where they were (the first spot counts).
      const ref = new Map((g ? g.start : layout).map((it) => [it.i, it]))
      for (const it of out) {
        const was = ref.get(it.i)
        if (!was || it.i === g?.id || H.has(it.i)) continue
        if (it.x !== was.x || it.y !== was.y || it.w !== was.w) H.set(it.i, { x: was.x, y: was.y, w: was.w })
      }
      for (const id of H.keys()) if (!out.some((it) => it.i === id)) H.delete(id)
      if (g) {
        // Placed by hand: this block is where it belongs now…
        H.delete(g.id)
        // …and a block dropped onto another one's spot takes it over.
        const me = out.find((it) => it.i === g.id)
        if (me && g.kind === "drag") {
          for (const it of out) {
            const home = H.get(it.i)
            if (home && overlap(me, { ...it, x: home.x, y: home.y, w: home.w })) H.delete(it.i)
          }
        }
      }
      restore(out, H, g?.id)
      if (g?.final) {
        // Empty columns on the left go: those added during this gesture, and any
        // others while the board is wider than the screen (so it shrinks back).
        const right = Math.max(0, ...out.map((it) => it.x + it.w))
        const unused = Math.max(0, Math.min(...out.map((it) => it.x), Math.max(lead(), right - (limit() - lead()))))
        trimmed(unused)
        if (unused > 0) {
          for (const it of out) it.x -= unused
          for (const home of H.values()) home.x = Math.max(0, home.x - unused)
        }
      }
      homesOut(H)
      if (contactsOut) {
        const me = g && !g.final ? out.find((it) => it.i === g.id) : undefined
        contactsOut(me ? contactsOf(me, out) : [])
      }
      return out
    },
  }
}
