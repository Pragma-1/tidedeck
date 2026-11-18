import { accentVars } from "@/lib/accent"
import { displayCss } from "@/lib/display"
import type { Settings } from "@/lib/schema"

/** Fonts bundled in the image (self-hosted, nothing loads from Google). */
export const FONTS = {
  inter: { name: "Inter", note: "Tide default", stack: '"Inter Variable", Inter' },
  plex: { name: "IBM Plex Sans", note: "Technical, a little warmer", stack: '"IBM Plex Sans Variable", "IBM Plex Sans"' },
  manrope: { name: "Manrope", note: "Modern and rounded", stack: '"Manrope Variable", Manrope' },
  space: { name: "Space Grotesk", note: "Quirky geometric", stack: '"Space Grotesk Variable", "Space Grotesk"' },
  nunito: { name: "Nunito", note: "Soft and friendly", stack: '"Nunito Variable", Nunito' },
  atkinson: { name: "Atkinson Hyperlegible", note: "Made for low vision", stack: '"Atkinson Hyperlegible Next Variable", "Atkinson Hyperlegible Next"' },
  serif: { name: "Source Serif", note: "Bookish serif", stack: '"Source Serif 4 Variable", "Source Serif 4", Georgia' },
  mono: { name: "JetBrains Mono", note: "Everything monospaced", stack: '"JetBrains Mono Variable", ui-monospace' },
  system: { name: "System font", note: "Whatever your device uses", stack: "system-ui, -apple-system" },
} as const
export type FontId = keyof typeof FONTS
export const FONT_IDS = Object.keys(FONTS) as [FontId, ...FontId[]]

const FALLBACK = '"Segoe UI Variable", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif'

export function fontStack(font: Settings["font"], custom: string): string {
  if (font === "custom") {
    const name = custom.replace(/[^\w \-]/g, "").trim()
    return name ? `"${name}", ${FONTS.inter.stack}, ${FALLBACK}` : `${FONTS.inter.stack}, ${FALLBACK}`
  }
  return `${FONTS[font].stack}, ${FALLBACK}`
}

/** Page backgrounds drawn behind the blocks, one version per theme. */
export const GRADIENTS = {
  aurora: {
    name: "Aurora",
    light:
      "radial-gradient(1100px 650px at 5% -5%, rgb(60 190 160 / 0.20), transparent 62%), radial-gradient(1000px 620px at 100% 0%, rgb(140 100 230 / 0.16), transparent 60%)",
    dark: "radial-gradient(1100px 650px at 5% -5%, rgb(60 200 165 / 0.20), transparent 62%), radial-gradient(1000px 620px at 100% 0%, rgb(150 110 240 / 0.22), transparent 60%)",
  },
  tidepool: {
    name: "Tide pool",
    light:
      "radial-gradient(1200px 700px at 15% 0%, rgb(61 90 128 / 0.16), transparent 60%), radial-gradient(900px 600px at 90% 100%, rgb(47 111 98 / 0.14), transparent 60%)",
    dark: "radial-gradient(1200px 700px at 15% 0%, rgb(142 174 219 / 0.16), transparent 60%), radial-gradient(900px 600px at 90% 100%, rgb(124 196 180 / 0.12), transparent 60%)",
  },
  dusk: {
    name: "Dusk",
    light:
      "radial-gradient(1100px 650px at 0% 0%, rgb(169 154 214 / 0.22), transparent 60%), radial-gradient(1000px 650px at 100% 100%, rgb(224 178 90 / 0.20), transparent 60%)",
    dark: "radial-gradient(1100px 650px at 0% 0%, rgb(120 90 200 / 0.22), transparent 60%), radial-gradient(1000px 650px at 100% 100%, rgb(224 150 70 / 0.16), transparent 60%)",
  },
  mist: {
    name: "Mist",
    light: "linear-gradient(180deg, rgb(61 90 128 / 0.10), transparent 55%), linear-gradient(0deg, rgb(183 128 42 / 0.06), transparent 40%)",
    dark: "linear-gradient(180deg, rgb(142 174 219 / 0.09), transparent 55%), linear-gradient(0deg, rgb(224 178 90 / 0.05), transparent 40%)",
  },
} as const
export type GradientId = keyof typeof GRADIENTS
export const GRADIENT_IDS = Object.keys(GRADIENTS) as [GradientId, ...GradientId[]]

export type ThemePreset = {
  id: string
  name: string
  accent: string
  accentLight: string
  font: FontId
  background: { mode: "theme" | "color" | "gradient"; colorLight: string; colorDark: string; gradient: GradientId }
  band: { light: string; dark: string }
}

const bg = (mode: ThemePreset["background"]["mode"], colorLight = "", colorDark = "", gradient: GradientId = "aurora") => ({
  mode,
  colorLight,
  colorDark,
  gradient,
})

/** One-click looks. Tide is Tidewiki's design; the rest are its relatives. */
export const THEME_PRESETS: ThemePreset[] = [
  { id: "tide", name: "Tide", accent: "#8eaedb", accentLight: "#3d5a80", font: "inter", background: bg("theme"), band: { light: "", dark: "" } },
  {
    id: "harbour",
    name: "Harbour night",
    accent: "#7fb2f0",
    accentLight: "#2c5a96",
    font: "inter",
    background: bg("color", "#eef2f7", "#0c1420"),
    band: { light: "#16263b", dark: "#070d16" },
  },
  {
    id: "sandbar",
    name: "Sandbar",
    accent: "#e0b25a",
    accentLight: "#8a5d17",
    font: "manrope",
    background: bg("color", "#f4efe6", "#16130e"),
    band: { light: "#3a3127", dark: "#0e0b07" },
  },
  {
    id: "kelp",
    name: "Kelp forest",
    accent: "#7cc4b4",
    accentLight: "#2f6f62",
    font: "nunito",
    background: bg("color", "#edf3f0", "#0d1412"),
    band: { light: "#1e3a33", dark: "#060e0b" },
  },
  {
    id: "heather",
    name: "Heather",
    accent: "#b4a4e6",
    accentLight: "#5b4b8a",
    font: "plex",
    background: bg("color", "#f3f1f7", "#131119"),
    band: { light: "#2e2840", dark: "#0b0910" },
  },
  {
    id: "aurora",
    name: "Aurora",
    accent: "#8fe3c8",
    accentLight: "#1f7a63",
    font: "space",
    background: bg("gradient", "", "", "aurora"),
    band: { light: "#101a24", dark: "#05080c" },
  },
  {
    id: "paper",
    name: "Paper",
    accent: "#9fb6e0",
    accentLight: "#2f4a7a",
    font: "serif",
    background: bg("color", "#faf8f2", "#191816"),
    band: { light: "#2b2a27", dark: "#0d0c0b" },
  },
  {
    id: "phosphor",
    name: "Phosphor",
    accent: "#ffb454",
    accentLight: "#9a5b00",
    font: "mono",
    background: bg("color", "#f3f1ea", "#0b0a08"),
    band: { light: "#1a1712", dark: "#040302" },
  },
  {
    id: "legible",
    name: "Clear view",
    accent: "#9cc3ff",
    accentLight: "#1f4f99",
    font: "atkinson",
    background: bg("theme"),
    band: { light: "", dark: "" },
  },
]

export function presetMatches(p: ThemePreset, s: Settings): boolean {
  return (
    s.accent.toLowerCase() === p.accent &&
    (s.accentLight || "").toLowerCase() === p.accentLight &&
    s.font === p.font &&
    s.background.mode === p.background.mode &&
    (p.background.mode !== "color" ||
      (s.background.colorLight === p.background.colorLight && s.background.colorDark === p.background.colorDark)) &&
    (p.background.mode !== "gradient" || s.background.gradient === p.background.gradient) &&
    s.band.light === p.band.light &&
    s.band.dark === p.band.dark
  )
}

// --- CSS -------------------------------------------------------------------

/** Surfaces derived from a custom page colour, so cards and lines stay in tune with it. */
function lightSurfaces(c: string) {
  return [
    `--bg: ${c}`,
    `--sheet: color-mix(in oklab, ${c} 18%, white)`,
    `--panel: color-mix(in oklab, ${c} 55%, white)`,
    `--line: color-mix(in oklab, ${c} 88%, black)`,
    `--line-2: color-mix(in oklab, ${c} 94%, black)`,
    `--secondary: color-mix(in oklab, ${c} 92%, black)`,
    `--accent: color-mix(in oklab, ${c} 70%, white)`,
    `--input: color-mix(in oklab, ${c} 80%, black)`,
    `--code: color-mix(in oklab, ${c} 40%, white)`,
  ]
}
function darkSurfaces(c: string) {
  return [
    `--bg: ${c}`,
    `--sheet: color-mix(in oklab, ${c} 94%, white)`,
    `--panel: color-mix(in oklab, ${c} 90%, white)`,
    `--line: color-mix(in oklab, ${c} 80%, white)`,
    `--line-2: color-mix(in oklab, ${c} 86%, white)`,
    `--secondary: color-mix(in oklab, ${c} 86%, white)`,
    `--accent: color-mix(in oklab, ${c} 87%, white)`,
    `--input: color-mix(in oklab, ${c} 74%, white)`,
    `--code: color-mix(in oklab, ${c} 92%, black)`,
  ]
}

/**
 * Everything the "Look" settings change, as one stylesheet. Rendered on the
 * server (no flash of the default look) and replaced live in the browser.
 * Only validated values reach it: hex colours, known ids, a cleaned font name.
 */
export function themeCss(s: Settings): string {
  const light: string[] = [`--sans: ${fontStack(s.font, s.customFont)}`]
  const dark: string[] = []
  for (const [k, v] of Object.entries(accentVars(s.accent, s.accentLight))) light.push(`${k}: ${v}`)

  if (s.background.mode === "color") {
    if (s.background.colorLight) light.push(...lightSurfaces(s.background.colorLight))
    if (s.background.colorDark) dark.push(...darkSurfaces(s.background.colorDark))
  }
  if (s.band.light) light.push(`--band: ${s.band.light}`)
  if (s.band.dark) dark.push(`--band: ${s.band.dark}`)

  let css = displayCss(s.display) + `:root{${light.join(";")}}`
  if (dark.length) css += `html[data-theme="dark"]{${dark.join(";")}}`
  if (s.background.mode === "gradient") {
    const g = GRADIENTS[s.background.gradient]
    css += `body{background-image:${g.light};background-attachment:fixed}`
    css += `html[data-theme="dark"] body{background-image:${g.dark}}`
  }
  // Rendered into a <style> element: values are validated, but never let one close it.
  return css.replace(/</g, "\\3c ")
}
