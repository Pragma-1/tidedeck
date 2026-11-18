import type { StoredLayoutItem } from "@/lib/schema"

type Item = StoredLayoutItem

/**
 * Layout for a narrower screen, made from one arranged for a wider one, used
 * until the narrower layout is arranged by hand.
 *
 * - Medium (32 of 48 columns): same arrangement, scaled; overlaps move down.
 * - Small (tablets): two even columns. Blocks keep their reading order and
 *   flow into whichever column is shorter; blocks that spanned most of the
 *   wide layout stay full width.
 * - Phones: one column, in reading order.
 */
export function deriveLayout(source: Item[], srcCols: number, cols: number): Item[] {
  const order = [...source].sort((a, b) => a.y - b.y || a.x - b.x)
  if (cols >= srcCols) return order.map((it) => ({ i: it.i, y: it.y, h: it.h, w: Math.min(it.w, cols), x: Math.min(it.x, Math.max(0, cols - Math.min(it.w, cols))) }))

  const share = (it: Item) => it.w / srcCols

  if (cols <= 8) {
    let y = 0
    return order.map((it) => {
      const out = { i: it.i, x: 0, y, w: cols, h: it.h }
      y += it.h
      return out
    })
  }

  if (cols <= 16) {
    const half = cols / 2
    const heights = [0, 0]
    const out: Item[] = []
    for (const it of order) {
      if (share(it) > 0.6) {
        const y = Math.max(...heights)
        out.push({ i: it.i, x: 0, y, w: cols, h: it.h })
        heights[0] = heights[1] = y + it.h
      } else {
        const col = heights[0] <= heights[1] ? 0 : 1
        out.push({ i: it.i, x: col * half, y: heights[col], w: half, h: it.h })
        heights[col] += it.h
      }
    }
    return out
  }

  // Scale positions and widths, then let every block fall down past anything it overlaps.
  const ratio = cols / srcCols
  const placed: Item[] = []
  const overlaps = (a: Item, b: Item) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  for (const it of order) {
    // Scale both edges, so neighbours stay flush (no rounding gaps between them).
    const left = Math.round(it.x * ratio)
    const w = Math.max(1, Math.min(cols, Math.round((it.x + it.w) * ratio) - left))
    const x = Math.max(0, Math.min(cols - w, left))
    const next: Item = { i: it.i, x, y: it.y, w, h: it.h }
    for (let hit = placed.find((p) => overlaps(p, next)); hit; hit = placed.find((p) => overlaps(p, next))) {
      next.y = hit.y + hit.h
    }
    placed.push(next)
  }
  return placed
}
