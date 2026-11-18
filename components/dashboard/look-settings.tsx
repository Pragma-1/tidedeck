"use client"

import { Check, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/dashboard/fields"
import { SizeSettings } from "@/components/dashboard/size-settings"
import { ACCENT_PRESETS, accentVars } from "@/lib/accent"
import type { Settings } from "@/lib/schema"
import { FONTS, GRADIENTS, THEME_PRESETS, fontStack, presetMatches, type GradientId, type ThemePreset } from "@/lib/theme"
import { cn } from "@/lib/utils"

type Set = (fn: (s: Settings) => void) => void

const STONE = { light: { bg: "#f2f2ef", band: "#2a2f36" }, dark: { bg: "#111316", band: "#0b0d10" } }

function applyPreset(s: Settings, p: ThemePreset) {
  s.preset = p.id
  s.accent = p.accent
  s.accentLight = p.accentLight
  s.font = p.font
  s.customFont = ""
  s.background = { ...s.background, ...p.background }
  s.band = { ...p.band }
}

/** A tiny picture of the preset: band, page, a card, accent and a sample of the font. */
function PresetCard({ p, active, onPick }: { p: ThemePreset; active: boolean; onPick: () => void }) {
  const dark = p.background.mode === "color" && p.background.colorDark ? p.background.colorDark : STONE.dark.bg
  const band = p.band.dark || STONE.dark.band
  const gradient = p.background.mode === "gradient" ? GRADIENTS[p.background.gradient].dark : undefined
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={cn(
        "group overflow-hidden rounded-[0.9rem_0.3rem_0.9rem_0.3rem] border text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-border",
      )}
    >
      <span className="block h-16" style={{ background: dark, backgroundImage: gradient }}>
        <span className="block h-5" style={{ background: band }} />
        <span className="mx-2 -mt-2 flex h-9 items-center gap-1.5 rounded-[0.5rem_0.15rem_0.5rem_0.15rem] px-2" style={{ background: `color-mix(in oklab, ${dark} 92%, white)` }}>
          <span className="size-2.5 rounded-full" style={{ background: p.accent }} />
          <span className="text-sm font-semibold text-white/90" style={{ fontFamily: fontStack(p.font, "") }}>
            Aa
          </span>
          <span className="ml-auto h-1.5 w-8 rounded-full" style={{ background: accentVars(p.accent, p.accentLight)["--brand-d"], opacity: 0.6 }} />
        </span>
      </span>
      <span className="flex items-center justify-between gap-1 px-2.5 py-1.5 text-xs">
        <span className="font-medium">{p.name}</span>
        {active && <Check className="size-3.5 text-primary" />}
      </span>
    </button>
  )
}

function ColorPair({
  label,
  hint,
  light,
  dark,
  fallback,
  onLight,
  onDark,
}: {
  label: string
  hint?: string
  light: string
  dark: string
  fallback: { light: string; dark: string }
  onLight: (v: string) => void
  onDark: (v: string) => void
}) {
  return (
    <Field label={label} hint={hint}>
      {() => (
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["Light theme", light, fallback.light, onLight],
              ["Dark theme", dark, fallback.dark, onDark],
            ] as const
          ).map(([name, value, fb, on]) => (
            <label key={name} className="flex items-center gap-2 rounded-[0.55rem] border bg-card py-1 pr-1 pl-1.5 text-sm">
              <input
                type="color"
                aria-label={`${label}, ${name.toLowerCase()}`}
                value={value || fb}
                onChange={(e) => on(e.target.value)}
                className="size-7 cursor-pointer rounded-md border-0 bg-transparent p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border [&::-webkit-color-swatch-wrapper]:p-0"
              />
              <span className="min-w-20">
                {name}
                <span className="block font-mono text-[0.7rem] text-muted-foreground">{value || "default"}</span>
              </span>
              {value && (
                <button type="button" onClick={() => on("")} className="rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent" aria-label={`Reset ${name.toLowerCase()}`}>
                  Reset
                </button>
              )}
            </label>
          ))}
        </div>
      )}
    </Field>
  )
}

export function LookSettings({ settings, set }: { settings: Settings; set: Set }) {
  const bg = settings.background
  const custom = (fn: (s: Settings) => void) =>
    set((s) => {
      fn(s)
      s.preset = "custom"
    })

  return (
    <div className="grid gap-6">
      <section className="grid gap-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Presets</h3>
          <Button variant="ghost" size="sm" onClick={() => set((s) => applyPreset(s, THEME_PRESETS[0]))}>
            <RotateCcw /> Back to Tide
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {THEME_PRESETS.map((p) => (
            <PresetCard key={p.id} p={p} active={presetMatches(p, settings)} onPick={() => set((s) => applyPreset(s, p))} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">A preset sets colours, background and font. Change anything below to make it your own.</p>
      </section>

      <Field label="Default theme" hint="Each browser can still switch with the sun/moon button.">
        {(id) => (
          <Select value={settings.theme} onValueChange={(v) => set((s) => void (s.theme = v as Settings["theme"]))}>
            <SelectTrigger id={id} className="sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">Follow device</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="light">Light</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>

      <SizeSettings settings={settings} set={set} />

      <section className="grid gap-3">
        <h3 className="text-sm font-semibold">Accent colour</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {ACCENT_PRESETS.map((p) => {
            const on = settings.accent.toLowerCase() === p.hex && (!settings.accentLight || settings.accentLight === p.light)
            return (
              <button
                key={p.hex}
                type="button"
                title={p.name}
                aria-label={p.name}
                aria-pressed={on}
                onClick={() =>
                  custom((s) => {
                    s.accent = p.hex
                    s.accentLight = p.light ?? ""
                  })
                }
                className={cn("size-8 rounded-full ring-offset-2 ring-offset-popover", on && "ring-2 ring-foreground")}
                style={{ background: `linear-gradient(135deg, ${p.light ?? p.hex} 50%, ${p.hex} 50%)` }}
              />
            )
          })}
        </div>
        <ColorPair
          label="Your own"
          hint="Pick each theme separately. Leave the light one on default and it's derived from the dark one."
          light={settings.accentLight}
          dark={settings.accent}
          fallback={{ light: accentVars(settings.accent, "")["--brand-l"], dark: "#8eaedb" }}
          onLight={(v) => custom((s) => void (s.accentLight = v))}
          onDark={(v) => custom((s) => void (s.accent = v || "#8eaedb"))}
        />
      </section>

      <section className="grid gap-3">
        <h3 className="text-sm font-semibold">Font</h3>
        <Select value={settings.font} onValueChange={(v) => custom((s) => void (s.font = v as Settings["font"]))}>
          <SelectTrigger aria-label="Font" className="sm:w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.entries(FONTS) as Array<[keyof typeof FONTS, (typeof FONTS)[keyof typeof FONTS]]>).map(([id, f]) => (
              <SelectItem key={id} value={id}>
                <span style={{ fontFamily: fontStack(id, "") }}>{f.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{f.note}</span>
              </SelectItem>
            ))}
            <SelectItem value="custom">Another font on my device…</SelectItem>
          </SelectContent>
        </Select>
        {settings.font === "custom" && (
          <Field
            label="Font name"
            hint="Must be installed on every device that opens the dashboard; others fall back to Inter."
            error={/^[\w \-]*$/.test(settings.customFont) ? null : "Letters, numbers, spaces and dashes only"}
          >
            {(id) => (
              <Input
                id={id}
                value={settings.customFont}
                maxLength={60}
                placeholder="Segoe UI"
                onChange={(e) => custom((s) => void (s.customFont = e.target.value))}
              />
            )}
          </Field>
        )}
        <p className="rounded-[0.55rem] border bg-muted px-3 py-2 text-sm" style={{ fontFamily: fontStack(settings.font, settings.customFont) }}>
          The quick brown fox jumps over 13 lazy servers.
        </p>
      </section>

      <section className="grid gap-3">
        <h3 className="text-sm font-semibold">Background</h3>
        <div className="flex flex-wrap gap-1 rounded-[0.6rem] bg-muted p-1" role="radiogroup" aria-label="Background">
          {(
            [
              ["theme", "Theme"],
              ["color", "Colour"],
              ["gradient", "Gradient"],
              ["image", "Image"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={bg.mode === mode}
              onClick={() => custom((s) => void (s.background.mode = mode))}
              className={cn(
                "flex-1 rounded-[0.45rem] px-3 py-1.5 text-sm transition-colors",
                bg.mode === mode ? "bg-card font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {bg.mode === "theme" && <p className="text-xs text-muted-foreground">Tidewiki&apos;s stone grey, light and dark.</p>}

        {bg.mode === "color" && (
          <ColorPair
            label="Page colour"
            hint="Blocks, lines and fields are tinted to match."
            light={bg.colorLight}
            dark={bg.colorDark}
            fallback={{ light: STONE.light.bg, dark: STONE.dark.bg }}
            onLight={(v) => custom((s) => void (s.background.colorLight = v))}
            onDark={(v) => custom((s) => void (s.background.colorDark = v))}
          />
        )}

        {bg.mode === "gradient" && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.entries(GRADIENTS) as Array<[GradientId, (typeof GRADIENTS)[GradientId]]>).map(([id, g]) => (
              <button
                key={id}
                type="button"
                aria-pressed={bg.gradient === id}
                onClick={() => custom((s) => void (s.background.gradient = id))}
                className={cn("overflow-hidden rounded-[0.7rem] border text-left text-xs", bg.gradient === id && "ring-2 ring-primary")}
              >
                <span className="block h-12" style={{ background: STONE.dark.bg, backgroundImage: g.dark }} />
                <span className="block px-2 py-1.5 font-medium">{g.name}</span>
              </button>
            ))}
          </div>
        )}

        {bg.mode === "image" && (
          <>
            <Field label="Image" hint="An image URL, or a file in the public folder (e.g. /backgrounds/sea.jpg).">
              {(id) => (
                <Input id={id} value={bg.imageUrl} placeholder="https://…" onChange={(e) => custom((s) => void (s.background.imageUrl = e.target.value))} />
              )}
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={`Blur ${bg.blur}px`}>
                {() => <Slider aria-label="Background blur" min={0} max={40} value={[bg.blur]} onValueChange={([v]) => custom((s) => void (s.background.blur = v))} />}
              </Field>
              <Field label={`Darken ${bg.dim}%`}>
                {() => <Slider aria-label="Background darkening" min={0} max={90} value={[bg.dim]} onValueChange={([v]) => custom((s) => void (s.background.dim = v))} />}
              </Field>
            </div>
          </>
        )}

        <ColorPair
          label="Header band"
          light={settings.band.light}
          dark={settings.band.dark}
          fallback={{ light: STONE.light.band, dark: STONE.dark.band }}
          onLight={(v) => custom((s) => void (s.band.light = v))}
          onDark={(v) => custom((s) => void (s.band.dark = v))}
        />

        <Field label={`Block opacity ${settings.cardOpacity}%`} hint="Below 100% the background shows through, frosted.">
          {() => <Slider aria-label="Block opacity" min={20} max={100} value={[settings.cardOpacity]} onValueChange={([v]) => set((s) => void (s.cardOpacity = v))} />}
        </Field>
      </section>

      <Field label="Custom CSS" hint="Applied after everything else. Blocks have the class .block-surface, the header .band.">
        {(id) => (
          <Textarea
            id={id}
            rows={4}
            spellCheck={false}
            className="font-mono text-xs"
            value={settings.customCss}
            placeholder=".block-surface { border-radius: 4px; }"
            onChange={(e) => set((s) => void (s.customCss = e.target.value))}
          />
        )}
      </Field>
    </div>
  )
}
