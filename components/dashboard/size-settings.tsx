"use client"

import { useEffect, useState } from "react"
import { Slider } from "@/components/ui/slider"
import { Field, ToggleRow } from "@/components/dashboard/fields"
import { useDeviceDisplay, useScale } from "@/hooks/use-display"
import { SIZE_MAX, SIZE_MIN, shownPercent, type Display } from "@/lib/display"
import type { Settings } from "@/lib/schema"
import { cn } from "@/lib/utils"

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: ReadonlyArray<readonly [T, string]>
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-[0.6rem] bg-muted p-1" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "flex-1 rounded-[0.45rem] px-3 py-1.5 text-sm transition-colors",
            value === v ? "bg-card font-semibold shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/**
 * Dashboard size: automatic by window width (default) or fixed, plus the page
 * width. Either shared by everyone, or kept for this browser only.
 */
export function SizeSettings({ settings, set }: { settings: Settings; set: (fn: (s: Settings) => void) => void }) {
  const device = useDeviceDisplay((s) => s.device)
  const setDevice = useDeviceDisplay((s) => s.setDevice)
  const scale = useScale()
  const d = device ?? settings.display
  const change = (patch: Partial<Display>) =>
    device ? setDevice({ ...device, ...patch }) : set((s) => void (s.display = { ...s.display, ...patch }))

  // The whole dialog rescales with the size, so the slider only applies when released.
  const [draft, setDraft] = useState(d.size)
  useEffect(() => setDraft(d.size), [d.size])

  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-semibold">Size</h3>
      <Segmented
        label="Size"
        value={d.scale}
        options={[
          ["auto", "Fit the screen"],
          ["fixed", "Fixed"],
        ]}
        onChange={(scale) => change({ scale })}
      />
      <Field
        label={d.scale === "auto" ? `Adjust ${draft}%` : `Size ${draft}%`}
        hint={
          d.scale === "auto"
            ? `Grows on screens wider than 2048 px; browser zoom (Ctrl + / −) works on top. Right now everything is shown at ${shownPercent(scale)}%.`
            : `Everything is shown at ${draft}%, on every screen.`
        }
      >
        {() => (
          <Slider
            aria-label="Dashboard size"
            min={SIZE_MIN}
            max={SIZE_MAX}
            step={5}
            value={[draft]}
            onValueChange={([v]) => setDraft(v)}
            onValueCommit={([v]) => change({ size: v })}
          />
        )}
      </Field>
      <Field label="Page width" hint="How wide the board may get before it's centred. Scales with the size.">
        {() => (
          <Segmented
            label="Page width"
            value={d.width}
            options={[
              ["standard", "Standard"],
              ["wide", "Wide"],
              ["full", "Full width"],
            ]}
            onChange={(width) => change({ width })}
          />
        )}
      </Field>
      <ToggleRow
        label="Only on this device"
        description={
          device
            ? "This browser keeps its own size. Turn off to use the shared one again."
            : "Give this browser its own size, e.g. for a wall screen. Stored in this browser."
        }
        checked={!!device}
        onCheckedChange={(on) => setDevice(on ? { ...settings.display } : null)}
      />
    </section>
  )
}
