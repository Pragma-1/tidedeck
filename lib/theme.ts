import { accentVars } from "@/lib/accent"
import { displayCss } from "@/lib/display"
import type { Settings } from "@/lib/schema"

import fontFiles from "@/lib/font-files.json"

export const FONT_GROUPS = ["Clean", "Friendly", "Serif", "Futuristic", "Condensed and bold", "Retro", "Handwritten", "Monospace", "Device"] as const

/** adjust: the font's small letters are much smaller than usual; scale them to about Inter's (CSS font-size-adjust). */
type FontInfo = { name: string; note: string; stack: string; group: (typeof FONT_GROUPS)[number]; adjust?: number }

/**
 * Fonts bundled in the image (self-hosted, nothing loads from Google). Inter and
 * JetBrains Mono are part of the interface; every other one is its own small
 * stylesheet in /fonts, loaded only when it's the one in use (see font-files.json).
 */
export const FONTS = {
  inter: { name: "Inter", note: "Tide default", group: "Clean", stack: '"Inter Variable", Inter' },
  plex: { name: "IBM Plex Sans", note: "Technical, a little warmer", group: "Clean", stack: '"IBM Plex Sans Variable", "IBM Plex Sans"' },
  manrope: { name: "Manrope", note: "Modern and rounded", group: "Clean", stack: '"Manrope Variable", Manrope' },
  atkinson: { name: "Atkinson Hyperlegible", note: "Made for low vision", group: "Clean", stack: '"Atkinson Hyperlegible Next Variable", "Atkinson Hyperlegible Next"' },
  space: { name: "Space Grotesk", note: "Quirky geometric", group: "Friendly", stack: '"Space Grotesk Variable", "Space Grotesk"' },
  nunito: { name: "Nunito", note: "Soft and friendly", group: "Friendly", stack: '"Nunito Variable", Nunito' },
  comfortaa: { name: "Comfortaa", note: "Round, airy geometric", group: "Friendly", stack: '"Comfortaa Variable", Comfortaa' },
  quicksand: { name: "Quicksand", note: "Light and rounded", group: "Friendly", stack: '"Quicksand Variable", Quicksand' },
  syne: { name: "Syne", note: "Arty, wide when bold", group: "Friendly", stack: '"Syne Variable", Syne' },
  bricolage: { name: "Bricolage Grotesque", note: "Ink-trapped, characterful", group: "Friendly", stack: '"Bricolage Grotesque Variable", "Bricolage Grotesque"' },
  serif: { name: "Source Serif", note: "Bookish serif", group: "Serif", stack: '"Source Serif 4 Variable", "Source Serif 4", Georgia' },
  fraunces: { name: "Fraunces", note: "Soft, old-style serif", group: "Serif", stack: '"Fraunces Variable", Fraunces, Georgia' },
  playfair: { name: "Playfair Display", note: "High-contrast, elegant", group: "Serif", stack: '"Playfair Display Variable", "Playfair Display", Georgia' },
  dmserif: { name: "DM Serif Display", note: "Bold editorial headlines", group: "Serif", stack: '"DM Serif Display", Georgia' },
  orbitron: { name: "Orbitron", note: "Square sci-fi", group: "Futuristic", stack: '"Orbitron Variable", Orbitron' },
  exo: { name: "Exo 2", note: "Techy, easy to read", group: "Futuristic", stack: '"Exo 2 Variable", "Exo 2"' },
  unbounded: { name: "Unbounded", note: "Wide and loud", group: "Futuristic", stack: '"Unbounded Variable", Unbounded' },
  oswald: { name: "Oswald", note: "Condensed poster type", group: "Condensed and bold", stack: '"Oswald Variable", Oswald' },
  shoulders: { name: "Big Shoulders", note: "Tall, industrial", group: "Condensed and bold", stack: '"Big Shoulders Display Variable", "Big Shoulders Display"' },
  vt323: { name: "VT323", note: "Old terminal", group: "Retro", stack: "VT323, ui-monospace", adjust: 0.53 },
  pixelify: { name: "Pixelify Sans", note: "Pixel art, still readable", group: "Retro", stack: '"Pixelify Sans Variable", "Pixelify Sans"' },
  silkscreen: { name: "Silkscreen", note: "Tiny 8-bit capitals", group: "Retro", stack: "Silkscreen" },
  typewriter: { name: "Special Elite", note: "Worn typewriter", group: "Retro", stack: '"Special Elite", "Courier New", monospace' },
  courier: { name: "Courier Prime", note: "Clean typewriter", group: "Retro", stack: '"Courier Prime", "Courier New", monospace' },
  caveat: { name: "Caveat", note: "Handwritten notes", group: "Handwritten", stack: '"Caveat Variable", Caveat', adjust: 0.53 },
  mono: { name: "JetBrains Mono", note: "Everything monospaced", group: "Monospace", stack: '"JetBrains Mono Variable", ui-monospace' },
  recursive: { name: "Recursive", note: "Casual, semi-mono", group: "Monospace", stack: '"Recursive Variable", Recursive' },
  system: { name: "System font", note: "Whatever your device uses", group: "Device", stack: "system-ui, -apple-system" },
} as const satisfies Record<string, FontInfo>
export type FontId = keyof typeof FONTS
export const FONT_IDS = Object.keys(FONTS) as [FontId, ...FontId[]]

const FILES = fontFiles as Record<string, { pkg: string; css: string[] }>

/** The stylesheet a font needs (null: built in or the device's own). */
export function fontHref(font: Settings["font"]): string | null {
  return font !== "custom" && Object.hasOwn(FILES, font) ? `/fonts/${font}.css` : null
}

/** Every font with a stylesheet, for showing them side by side in the settings. */
export const FONT_SHEETS = Object.keys(FILES).map((id) => `/fonts/${id}.css`)

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
  synthwave: {
    name: "Synthwave",
    light:
      "radial-gradient(1200px 600px at 50% 110%, rgb(255 80 180 / 0.22), transparent 65%), radial-gradient(1000px 520px at 50% -10%, rgb(80 200 255 / 0.18), transparent 60%), linear-gradient(180deg, rgb(120 60 200 / 0.08), rgb(255 90 170 / 0.08))",
    dark: "radial-gradient(1200px 600px at 50% 110%, rgb(255 60 170 / 0.30), transparent 65%), radial-gradient(1000px 520px at 50% -10%, rgb(60 200 255 / 0.20), transparent 60%), linear-gradient(180deg, rgb(70 20 140 / 0.35), rgb(150 20 110 / 0.22))",
  },
  sunset: {
    name: "Sunset",
    light:
      "radial-gradient(1300px 700px at 85% 105%, rgb(255 130 60 / 0.24), transparent 62%), radial-gradient(1000px 600px at 0% 0%, rgb(230 90 130 / 0.16), transparent 60%)",
    dark: "radial-gradient(1300px 700px at 85% 105%, rgb(255 120 50 / 0.26), transparent 62%), radial-gradient(1000px 600px at 0% 0%, rgb(200 60 120 / 0.22), transparent 60%)",
  },
  reef: {
    name: "Reef",
    light:
      "radial-gradient(1100px 650px at 100% 0%, rgb(255 130 110 / 0.20), transparent 60%), radial-gradient(1100px 700px at 0% 100%, rgb(40 180 170 / 0.18), transparent 62%)",
    dark: "radial-gradient(1100px 650px at 100% 0%, rgb(255 120 100 / 0.20), transparent 60%), radial-gradient(1100px 700px at 0% 100%, rgb(30 170 160 / 0.22), transparent 62%)",
  },
} as const
export type GradientId = keyof typeof GRADIENTS
export const GRADIENT_IDS = Object.keys(GRADIENTS) as [GradientId, ...GradientId[]]

export const PRESET_GROUPS = ["Tide", "Colour schemes", "Styles", "Sea and nature"] as const

export type ThemePreset = {
  id: string
  name: string
  group: (typeof PRESET_GROUPS)[number]
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
  // Tide: Tidewiki's design and its relatives.
  { id: "tide", group: "Tide", name: "Tide", accent: "#8eaedb", accentLight: "#3d5a80", font: "inter", background: bg("theme"), band: { light: "", dark: "" } },
  { id: "harbour", group: "Tide", name: "Harbour night", accent: "#7fb2f0", accentLight: "#2c5a96", font: "inter", background: bg("color", "#eef2f7", "#0c1420"), band: { light: "#16263b", dark: "#070d16" } },
  { id: "sandbar", group: "Tide", name: "Sandbar", accent: "#e0b25a", accentLight: "#8a5d17", font: "manrope", background: bg("color", "#f4efe6", "#16130e"), band: { light: "#3a3127", dark: "#0e0b07" } },
  { id: "kelp", group: "Tide", name: "Kelp forest", accent: "#7cc4b4", accentLight: "#2f6f62", font: "nunito", background: bg("color", "#edf3f0", "#0d1412"), band: { light: "#1e3a33", dark: "#060e0b" } },
  { id: "heather", group: "Tide", name: "Heather", accent: "#b4a4e6", accentLight: "#5b4b8a", font: "plex", background: bg("color", "#f3f1f7", "#131119"), band: { light: "#2e2840", dark: "#0b0910" } },
  { id: "aurora", group: "Tide", name: "Aurora", accent: "#8fe3c8", accentLight: "#1f7a63", font: "space", background: bg("gradient", "", "", "aurora"), band: { light: "#101a24", dark: "#05080c" } },
  { id: "paper", group: "Tide", name: "Paper", accent: "#9fb6e0", accentLight: "#2f4a7a", font: "serif", background: bg("color", "#faf8f2", "#191816"), band: { light: "#2b2a27", dark: "#0d0c0b" } },
  { id: "phosphor", group: "Tide", name: "Phosphor", accent: "#ffb454", accentLight: "#9a5b00", font: "mono", background: bg("color", "#f3f1ea", "#0b0a08"), band: { light: "#1a1712", dark: "#040302" } },
  { id: "legible", group: "Tide", name: "Clear view", accent: "#9cc3ff", accentLight: "#1f4f99", font: "atkinson", background: bg("theme"), band: { light: "", dark: "" } },

  // Well-known editor colour schemes, in their own colours (dark and light variants).
  { id: "nord", group: "Colour schemes", name: "Nord", accent: "#88c0d0", accentLight: "#5e81ac", font: "plex", background: bg("color", "#eceff4", "#2e3440"), band: { light: "#3b4252", dark: "#242933" } },
  { id: "dracula", group: "Colour schemes", name: "Dracula", accent: "#bd93f9", accentLight: "#644ac9", font: "mono", background: bg("color", "#fffbeb", "#282a36"), band: { light: "#3a3c4e", dark: "#1e1f29" } },
  { id: "gruvbox", group: "Colour schemes", name: "Gruvbox", accent: "#fabd2f", accentLight: "#b57614", font: "recursive", background: bg("color", "#fbf1c7", "#282828"), band: { light: "#3c3836", dark: "#1d2021" } },
  { id: "catppuccin", group: "Colour schemes", name: "Catppuccin", accent: "#cba6f7", accentLight: "#8839ef", font: "quicksand", background: bg("color", "#eff1f5", "#1e1e2e"), band: { light: "#313244", dark: "#11111b" } },
  { id: "tokyonight", group: "Colour schemes", name: "Tokyo Night", accent: "#7aa2f7", accentLight: "#2e7de9", font: "exo", background: bg("color", "#e1e2e7", "#1a1b26"), band: { light: "#24283b", dark: "#16161e" } },
  { id: "rosepine", group: "Colour schemes", name: "Rosé Pine", accent: "#c4a7e7", accentLight: "#907aa9", font: "fraunces", background: bg("color", "#faf4ed", "#191724"), band: { light: "#26233a", dark: "#12101b" } },
  { id: "solarized", group: "Colour schemes", name: "Solarized", accent: "#2aa198", accentLight: "#268bd2", font: "plex", background: bg("color", "#fdf6e3", "#002b36"), band: { light: "#073642", dark: "#00212b" } },

  // Looks built around a font.
  { id: "synthwave", group: "Styles", name: "Synthwave", accent: "#ff7edb", accentLight: "#c2187a", font: "orbitron", background: bg("gradient", "", "", "synthwave"), band: { light: "#2a0c4e", dark: "#120424" } },
  { id: "terminal", group: "Styles", name: "Terminal", accent: "#33ff66", accentLight: "#0a7a2a", font: "vt323", background: bg("color", "#eef5ee", "#050a06"), band: { light: "#0f2414", dark: "#020402" } },
  { id: "typewriter", group: "Styles", name: "Typewriter", accent: "#e06a5c", accentLight: "#a3261a", font: "typewriter", background: bg("color", "#f3ecdc", "#1c1a16"), band: { light: "#2d2a24", dark: "#0f0e0b" } },
  { id: "editorial", group: "Styles", name: "Editorial", accent: "#ff6b5a", accentLight: "#c0261a", font: "playfair", background: bg("color", "#fbfaf7", "#121212"), band: { light: "#1a1a1a", dark: "#050505" } },
  { id: "blueprint", group: "Styles", name: "Blueprint", accent: "#9cd0ff", accentLight: "#1d5fa3", font: "recursive", background: bg("color", "#e8f0f8", "#0e2a47"), band: { light: "#0b2440", dark: "#081c33" } },
  { id: "arcade", group: "Styles", name: "Arcade", accent: "#ffd319", accentLight: "#9a6b00", font: "pixelify", background: bg("color", "#f4f0ff", "#0d0221"), band: { light: "#241047", dark: "#06010f" } },
  { id: "poster", group: "Styles", name: "Poster", accent: "#ff7a3d", accentLight: "#b8460f", font: "oswald", background: bg("color", "#f2f0eb", "#141414"), band: { light: "#1f1f1f", dark: "#080808" } },
  { id: "notebook", group: "Styles", name: "Notebook", accent: "#7fb0ff", accentLight: "#2563c9", font: "caveat", background: bg("color", "#fdfbf3", "#1d1f24"), band: { light: "#2a2d35", dark: "#101115" } },

  // Sea and nature.
  { id: "deepsea", group: "Sea and nature", name: "Deep sea", accent: "#4fd1c5", accentLight: "#0e7c74", font: "manrope", background: bg("color", "#e6f0f6", "#04121f"), band: { light: "#0b2236", dark: "#020a12" } },
  { id: "reef", group: "Sea and nature", name: "Coral reef", accent: "#ff8a80", accentLight: "#c2453a", font: "comfortaa", background: bg("gradient", "", "", "reef"), band: { light: "#3a2a27", dark: "#0a0f12" } },
  { id: "arctic", group: "Sea and nature", name: "Arctic", accent: "#a5d8ff", accentLight: "#1c6aa3", font: "quicksand", background: bg("color", "#f3f8fb", "#0e1a22"), band: { light: "#23394a", dark: "#08121a" } },
  { id: "sunset", group: "Sea and nature", name: "Sunset", accent: "#ffb38a", accentLight: "#b4501c", font: "syne", background: bg("gradient", "", "", "sunset"), band: { light: "#3a1f1a", dark: "#170a0a" } },
  { id: "moss", group: "Sea and nature", name: "Moss", accent: "#a3c47a", accentLight: "#4d6b2a", font: "bricolage", background: bg("color", "#f1f4ec", "#10140e"), band: { light: "#273220", dark: "#080a06" } },
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
  const adjust = s.font !== "custom" ? (FONTS[s.font] as FontInfo).adjust : undefined
  const dark: string[] = []
  for (const [k, v] of Object.entries(accentVars(s.accent, s.accentLight))) light.push(`${k}: ${v}`)

  if (s.background.mode === "color") {
    if (s.background.colorLight) light.push(...lightSurfaces(s.background.colorLight))
    if (s.background.colorDark) dark.push(...darkSurfaces(s.background.colorDark))
  }
  if (s.band.light) light.push(`--band: ${s.band.light}`)
  if (s.band.dark) dark.push(`--band: ${s.band.dark}`)

  let css = displayCss(s.display) + `:root{${light.join(";")}}`
  if (adjust) css += `body{font-size-adjust:${adjust}}`
  if (dark.length) css += `html[data-theme="dark"]{${dark.join(";")}}`
  if (s.background.mode === "gradient") {
    const g = GRADIENTS[s.background.gradient]
    css += `body{background-image:${g.light};background-attachment:fixed}`
    css += `html[data-theme="dark"] body{background-image:${g.dark}}`
  }
  // Rendered into a <style> element: values are validated, but never let one close it.
  return css.replace(/</g, "\\3c ")
}
