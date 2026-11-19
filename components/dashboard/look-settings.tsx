"use client"

import { memo, useEffect, useId, useRef, useState } from "react"
import { Check, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Field } from "@/components/dashboard/fields"
import { SizeSettings } from "@/components/dashboard/size-settings"
import { ACCENT_PRESETS, accentVars } from "@/lib/accent"
import type { Settings } from "@/lib/schema"
import { FONT_GROUPS, FONT_SHEETS, FONTS, GRADIENTS, PRESET_GROUPS, THEME_PRESETS, fontStack, presetMatches, type FontId, type GradientId, type ThemePreset } from "@/lib/theme"
import { cn } from "@/lib/utils"

type Set = (fn: (s: Settings) => void) => void

const STONE = { light: { bg: "#f2f2ef", band: "#2a2f36" }, dark: { bg: "#111316", band: "#0b0d10" } }

function applyPreset(s: Settings, p: ThemePreset) {
  s.preset = p.id
  s.accent = p.accent
  s.accentLight = p.accentLight
  s.font = p.font
  s.customFont = ""
  // Base and gradient come from the preset; your image stays as it is.
  s.background = { ...s.background, ...p.background }
  s.band = { ...p.band }
}

/**
 * A tiny picture of the preset: band, page, a card, accent and a sample of the font.
 * Redrawn only when it gets (de)selected, not with every colour-picker step.
 */
const PresetCard = memo(PresetCardInner, (a, b) => a.p === b.p && a.active === b.active)

function PresetCardInner({ p, active, onPick }: { p: ThemePreset; active: boolean; onPick: () => void }) {
  const dark = p.background.base === "color" && p.background.colorDark ? p.background.colorDark : STONE.dark.bg
  const band = p.band.dark || STONE.dark.band
  const gradient = p.background.gradientOn ? GRADIENTS[p.background.gradient].dark : undefined
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

/**
 * A colour well. Dragging through the picker sends dozens of changes a second;
 * the dashboard takes at most one per frame (the well itself follows every one).
 */
function ColorWell({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const pending = useRef<string | null>(null)
  const frame = useRef(0)
  const send = useRef(onChange)
  send.current = onChange
  const flush = () => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    const v = pending.current
    pending.current = null
    if (v !== null) send.current(v)
    setDraft(null)
  }
  // Closing the dialog mid-drag still keeps the last colour.
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      if (pending.current !== null) send.current(pending.current)
    },
    [],
  )
  return (
    <input
      type="color"
      aria-label={label}
      value={draft ?? value}
      onChange={(e) => {
        pending.current = e.target.value
        setDraft(e.target.value)
        if (!frame.current) frame.current = requestAnimationFrame(flush)
      }}
      onBlur={() => pending.current !== null && flush()}
      className="size-7 cursor-pointer rounded-md border-0 bg-transparent p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border [&::-webkit-color-swatch-wrapper]:p-0"
    />
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
              <ColorWell label={`${label}, ${name.toLowerCase()}`} value={value || fb} onChange={on} />
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

/** The font list and the preset cards show every font: load their (small) stylesheets while the settings are open. */
function useAllFonts() {
  useEffect(() => {
    for (const href of FONT_SHEETS) {
      if (document.querySelector(`link[data-td-font-preview][href="${href}"]`)) continue
      const el = document.createElement("link")
      el.rel = "stylesheet"
      el.href = href
      el.dataset.tdFontPreview = ""
      document.head.appendChild(el)
    }
  }, [])
}

const FONT_LIST = FONT_GROUPS.map((group) => ({
  group,
  fonts: (Object.entries(FONTS) as Array<[FontId, (typeof FONTS)[FontId]]>).filter(([, f]) => f.group === group),
}))

export function LookSettings({ settings, set }: { settings: Settings; set: Set }) {
  useAllFonts()
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
        {PRESET_GROUPS.map((group) => (
          <div key={group} className="grid gap-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">{group}</h4>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {THEME_PRESETS.filter((p) => p.group === group).map((p) => (
                <PresetCard key={p.id} p={p} active={presetMatches(p, settings)} onPick={() => set((s) => applyPreset(s, p))} />
              ))}
            </div>
          </div>
        ))}
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
          <SelectContent className="max-h-[min(28rem,var(--radix-select-content-available-height))]">
            {FONT_LIST.map(({ group, fonts }, i) => (
              <SelectGroup key={group}>
                {i > 0 && <SelectSeparator />}
                <SelectLabel>{group}</SelectLabel>
                {fonts.map(([id, f]) => (
                  <SelectItem key={id} value={id}>
                    <span style={{ fontFamily: fontStack(id, "") }}>{f.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{f.note}</span>
                  </SelectItem>
                ))}
                {group === "Device" && <SelectItem value="custom">Another font on my device…</SelectItem>}
              </SelectGroup>
            ))}
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

      <BackgroundSettings settings={settings} custom={custom} />

      <section className="grid gap-3">
        <h3 className="text-sm font-semibold">Header and blocks</h3>
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

      <section className="grid gap-3">
        <h3 className="text-sm font-semibold">Custom CSS</h3>
        <Textarea
          aria-label="Custom CSS"
          aria-describedby="custom-css-hint"
          rows={4}
          spellCheck={false}
          className="font-mono text-xs"
          value={settings.customCss}
          placeholder=".block-surface { border-radius: 4px; }"
          onChange={(e) => set((s) => void (s.customCss = e.target.value))}
        />
        <p id="custom-css-hint" className="text-xs text-muted-foreground">
          Applied after everything else. Blocks have the class .block-surface, the header .band.
        </p>
      </section>
    </div>
  )
}

/** One layer of the background: a title with an on/off switch, its settings below while on. */
function Layer({
  title,
  hint,
  on,
  onChange,
  children,
}: {
  title: string
  hint: string
  on: boolean
  onChange: (on: boolean) => void
  children: React.ReactNode
}) {
  const id = useId()
  return (
    <div className={cn("grid gap-3 rounded-[0.8rem] border p-3.5", on && "border-primary/40")}>
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <label htmlFor={id} className="text-sm font-medium">
            {title}
          </label>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Switch id={id} checked={on} onCheckedChange={onChange} />
      </div>
      {on && children}
    </div>
  )
}

/**
 * The page background, in layers: the base (theme grey or your own colour, which
 * also tints blocks and lines), an image over it, and a gradient on top. Image and
 * gradient switch on and off independently and keep their settings while off.
 */
function BackgroundSettings({ settings, custom }: { settings: Settings; custom: Set }) {
  const bg = settings.background
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-semibold">Background</h3>

      <div className="grid gap-3 rounded-[0.8rem] border border-primary/40 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-0.5">
            <span className="text-sm font-medium" id="bg-base">
              Base
            </span>
            <p className="text-xs text-muted-foreground">The page colour. Blocks, lines and fields are tinted to match.</p>
          </div>
          <div className="flex gap-1 rounded-[0.6rem] bg-muted p-1" role="radiogroup" aria-labelledby="bg-base">
            {(
              [
                ["theme", "Theme grey"],
                ["color", "Own colour"],
              ] as const
            ).map(([base, label]) => (
              <button
                key={base}
                type="button"
                role="radio"
                aria-checked={bg.base === base}
                onClick={() => custom((s) => void (s.background.base = base))}
                className={cn(
                  "rounded-[0.45rem] px-3 py-1 text-sm transition-colors",
                  bg.base === base ? "bg-card font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {bg.base === "color" && (
          <ColorPair
            label="Page colour"
            light={bg.colorLight}
            dark={bg.colorDark}
            fallback={{ light: STONE.light.bg, dark: STONE.dark.bg }}
            onLight={(v) => custom((s) => void (s.background.colorLight = v))}
            onDark={(v) => custom((s) => void (s.background.colorDark = v))}
          />
        )}
      </div>

      <Layer
        title="Image"
        hint="Over the base. Darkening blends it towards the page colour."
        on={bg.imageOn}
        onChange={(on) => custom((s) => void (s.background.imageOn = on))}
      >
        <Field label="Image address" hint="An image URL, or a file in the public folder (e.g. /backgrounds/sea.jpg).">
          {(id) => (
            <Input
              id={id}
              value={bg.imageUrl}
              placeholder="https://…"
              onChange={(e) => custom((s) => void (s.background.imageUrl = e.target.value))}
            />
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
      </Layer>

      <Layer
        title="Gradient"
        hint="On top of everything, as a soft glow of colour."
        on={bg.gradientOn}
        onChange={(on) => custom((s) => void (s.background.gradientOn = on))}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Gradient">
          {(Object.entries(GRADIENTS) as Array<[GradientId, (typeof GRADIENTS)[GradientId]]>).map(([id, g]) => {
            const on = bg.gradient === id
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => custom((s) => void (s.background.gradient = id))}
                className={cn("overflow-hidden rounded-[0.7rem] border text-left text-xs", on && "ring-2 ring-primary")}
              >
                <span
                  className="block h-12"
                  style={{ background: bg.base === "color" && bg.colorDark ? bg.colorDark : STONE.dark.bg, backgroundImage: g.dark }}
                />
                <span className="block px-2 py-1.5 font-medium">{g.name}</span>
              </button>
            )
          })}
        </div>
      </Layer>
    </section>
  )
}
