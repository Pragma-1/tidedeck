/**
 * Dashboard size. Everything in the UI is sized in rem, so the whole dashboard
 * (header, blocks, text, grid rows) scales by changing the root font size.
 *
 * - auto:  grows with the *screen* (the monitor, not the window). 1× up to
 *          2048 px, then linear (2560 px → 1.25×, 3840 px → 1.875×), capped
 *          at 2.5×. `size` is a correction on top of that (e.g. 90 % = smaller).
 *          Measuring the window instead would undo browser zoom: zooming out
 *          to 50 % makes the window twice as wide in CSS pixels, which read as
 *          "bigger screen" and scaled everything back up.
 * - fixed: always `size` %, whatever the window.
 *
 * `width` caps the page width. It is in rem too, so it scales with the size.
 */
export const DISPLAY_WIDTHS = ["standard", "wide", "full"] as const

/**
 * Root font size at 100 % on an ordinary screen. 14.4 px is what used to be 90 %
 * of the browser's 16 px, which looked better as the normal size. The grid's own
 * units are still defined at 16 px ("1×"), so at 100 % the grid scale is 0.9.
 */
export const BASE_PX = 14.4
export const SIZE_MIN = 50
export const SIZE_MAX = 200

// The schema for this (with defaults) is `displaySchema` in lib/schema.ts.
export type Display = { scale: "auto" | "fixed"; size: number; width: (typeof DISPLAY_WIDTHS)[number] }

/** Checks a stored per-device size without the schema library (same rules as `displaySchema`). */
export function parseDisplay(v: unknown): Display | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  const scale = o.scale ?? "auto"
  const size = o.size ?? 100
  const width = o.width ?? "standard"
  if (scale !== "auto" && scale !== "fixed") return null
  if (typeof size !== "number" || !Number.isInteger(size) || size < SIZE_MIN || size > SIZE_MAX) return null
  if (typeof width !== "string" || !(DISPLAY_WIDTHS as readonly string[]).includes(width)) return null
  return { scale, size, width: width as Display["width"] }
}
export const DEFAULT_DISPLAY: Display = { scale: "auto", size: 100, width: "standard" }

export const PAGE_WIDTH: Record<Display["width"], string> = {
  standard: "105rem", // 1680 px at 1×
  wide: "150rem", // 2400 px at 1×
  full: "100000px",
}

/** Root font size: BASE_PX at 100 %. `--ui-auto` is the screen factor, set before the first paint. */
export function rootFontSize(d: Display): string {
  const f = d.size / 100
  return d.scale === "auto" ? `calc(${BASE_PX}px * var(--ui-auto, 1) * ${f})` : `${Math.round(BASE_PX * f * 100) / 100}px`
}

/** Screen factor from the monitor's width in CSS pixels at 100 % browser zoom. */
export function autoFactor(screenWidth: number): number {
  return Math.round(Math.min(2.5, Math.max(1, (screenWidth || 0) / 2048)) * 100) / 100
}

/**
 * Keeps `--ui-auto` in step when the window moves to another monitor, but not
 * when the browser zooms. Chromium and Safari keep screen.width fixed while
 * zooming; Firefox changes it, but then screen.width × devicePixelRatio (the
 * physical width) stays fixed. A real monitor change changes both.
 */
export function watchScreen(): () => void {
  let width = screen.width
  let physical = Math.round(screen.width * devicePixelRatio)
  const check = () => {
    const w = screen.width
    const p = Math.round(screen.width * devicePixelRatio)
    if (w !== width && p !== physical) {
      document.documentElement.style.setProperty("--ui-auto", String(autoFactor(w)))
      window.dispatchEvent(new Event("td-display"))
    }
    width = w
    physical = p
  }
  window.addEventListener("resize", check)
  return () => window.removeEventListener("resize", check)
}

export function displayCss(d: Display): string {
  return `html{font-size:${rootFontSize(d)};--page-max:${PAGE_WIDTH[d.width]}}`
}

/** Apply a display setting to this page (inline, so it wins over the shared one). */
export function applyDisplay(d: Display) {
  const s = document.documentElement.style
  s.fontSize = rootFontSize(d)
  s.setProperty("--page-max", PAGE_WIDTH[d.width])
  window.dispatchEvent(new Event("td-display"))
}

/** A size kept in this browser only (e.g. the wall TV), overriding the shared one. */
export const DEVICE_KEY = "tidedeck:display"

export function readDeviceDisplay(): Display | null {
  try {
    const raw = localStorage.getItem(DEVICE_KEY)
    if (!raw) return null
    return parseDisplay(JSON.parse(raw))
  } catch {
    return null
  }
}

export function writeDeviceDisplay(d: Display | null) {
  try {
    if (d) localStorage.setItem(DEVICE_KEY, JSON.stringify(d))
    else localStorage.removeItem(DEVICE_KEY)
  } catch {
    /* storage blocked: the setting lasts until reload */
  }
}

/**
 * Runs before the first paint so a device size doesn't flash the shared one
 * first. Mirrors rootFontSize/PAGE_WIDTH; every value is checked before use.
 */
export const DEVICE_SCRIPT = `try{document.documentElement.style.setProperty("--ui-auto",String(Math.round(Math.min(2.5,Math.max(1,(screen.width||0)/2048))*100)/100))}catch(e){}try{var d=JSON.parse(localStorage.getItem(${JSON.stringify(DEVICE_KEY)})||"null");if(d&&(d.scale==="auto"||d.scale==="fixed")&&typeof d.size==="number"&&d.size>=${SIZE_MIN}&&d.size<=${SIZE_MAX}){var f=Math.round(d.size)/100,s=document.documentElement.style,W=${JSON.stringify(PAGE_WIDTH)},w=Object.prototype.hasOwnProperty.call(W,d.width)?W[d.width]:W.standard;s.fontSize=d.scale==="auto"?"calc(${BASE_PX}px * var(--ui-auto, 1) * "+f+")":Math.round(${BASE_PX}*f*100)/100+"px";s.setProperty("--page-max",w)}}catch(e){}`

/** Current grid scale (root font size / 16 px; 0.9 at 100 %). */
export function currentScale(): number {
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(px) && px > 0 ? px / 16 : 1
}

/** Module zoom limits. */
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2.5
export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100))

/** The size as the settings show it: 100 % = BASE_PX on an ordinary screen. */
export const shownPercent = (scale: number): number => Math.round(((scale * 16) / BASE_PX) * 100)
