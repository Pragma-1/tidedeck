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
export function accentVars(hex: string): Record<string, string> {
  const base = /^#[0-9a-f]{6}$/i.test(hex) ? parse(hex) : parse("#c9a45c")
  const card = luminance([245, 246, 247])
  let light = base
  for (let k = 0; k < 12 && contrast(luminance(light), card) < 3; k++) light = light.map((c) => c * 0.88) as typeof base
  return {
    "--brand-d": toHex(base),
    "--brand-d-fg": foregroundFor(base),
    "--brand-l": toHex(light),
    "--brand-l-fg": foregroundFor(light),
  }
}

export const ACCENT_PRESETS = [
  { name: "Brass", hex: "#c9a45c" },
  { name: "Copper", hex: "#c47f5a" },
  { name: "Rosewood", hex: "#c0727e" },
  { name: "Heather", hex: "#a08bc4" },
  { name: "Sea glass", hex: "#7fb0aa" },
  { name: "Pewter", hex: "#a3aab3" },
]
