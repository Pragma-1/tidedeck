function parse(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = (rgb: number[]) => "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")

function luminance([r, g, b]: number[]) {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/** Dark text or light text, whichever reads better on the colour. */
function foregroundFor(rgb: number[]) {
  const l = luminance(rgb)
  return contrast(l, luminance([29, 26, 19])) >= contrast(l, 1) ? "#1d1a13" : "#ffffff"
}

/**
 * The accent is used as-is on dark surfaces. On light surfaces it is
 * darkened until it reaches about 3:1 against the light card colour.
 */
export function accentVars(hex: string, lightHex = ""): Record<string, string> {
  const valid = (h: string) => /^#[0-9a-f]{6}$/i.test(h)
  const base = valid(hex) ? parse(hex) : parse(DEFAULT_ACCENT)
  // A chosen light-theme colour wins; presets carry a hand-picked one (the same pairs Tidewiki uses);
  // otherwise the dark-theme colour is darkened until it reads well on white.
  const preset = ACCENT_PRESETS.find((p) => p.hex === hex.toLowerCase())
  const picked = valid(lightHex) ? lightHex : preset?.light
  const card = luminance([255, 255, 255])
  let light = picked ? parse(picked) : base
  for (let k = 0; !picked && k < 12 && contrast(luminance(light), card) < 4.5; k++) light = light.map((c) => c * 0.88) as typeof base
  return {
    "--brand-d": toHex(base),
    "--brand-d-fg": foregroundFor(base),
    "--brand-l": toHex(light),
    "--brand-l-fg": foregroundFor(light),
  }
}

/** Tidewiki's slate blue: #8eaedb on dark, #3d5a80 on light. */
export const DEFAULT_ACCENT = "#8eaedb"

export const ACCENT_PRESETS: Array<{ name: string; hex: string; light?: string }> = [
  { name: "Tide (slate blue)", hex: "#8eaedb", light: "#3d5a80" },
  { name: "Amber", hex: "#e0b25a", light: "#8a5d17" },
  { name: "Sea glass", hex: "#7cc4b4", light: "#2f6f62" },
  { name: "Heather", hex: "#a99ad6", light: "#5b4b8a" },
  { name: "Rosewood", hex: "#e09aa6", light: "#93404f" },
  { name: "Pewter", hex: "#a8b0ba", light: "#4f5864" },
]
