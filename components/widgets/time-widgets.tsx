"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { BlockOf } from "@/lib/schema"
import { useLocaleContext } from "@/hooks/use-locale-context"
import { cn } from "@/lib/utils"

/**
 * The current time, ticking. With the browser's locale and time zone known on
 * the server it starts right away (rendered with the page); otherwise after load.
 */
function useNow(stepMs: number, known: boolean) {
  const [now, setNow] = useState<Date | null>(() => (known ? new Date() : null))
  useEffect(() => {
    // Ticks right on the full second or minute (not some seconds after it), and again
    // straight away when the tab comes back or the computer wakes up.
    let t: ReturnType<typeof setTimeout>
    const tick = () => {
      const d = new Date()
      setNow(d)
      t = setTimeout(tick, stepMs - (d.getTime() % stepMs) + 15)
    }
    const wake = () => {
      if (document.visibilityState !== "visible") return
      clearTimeout(t)
      tick()
    }
    tick()
    document.addEventListener("visibilitychange", wake)
    return () => {
      clearTimeout(t)
      document.removeEventListener("visibilitychange", wake)
    }
  }, [stepMs])
  return now
}

const cityOf = (tz: string) => tz.split("/").pop()?.replace(/_/g, " ") ?? tz

function greetingFor(hour: number) {
  if (hour < 5) return "Good night"
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  if (hour < 22) return "Good evening"
  return "Good night"
}

/**
 * How wide a time reads, in em, for the clock's own font size (generous, so
 * it also fits the monospaced and serif fonts): digits ~0.62, colons and
 * spaces less, letters (AM/PM, other scripts) more.
 */
export function timeEms(text: string | undefined): number {
  if (!text) return 3.2
  let em = 0
  for (const ch of text) em += /\d/.test(ch) ? 0.64 : ch === ":" || ch === "." ? 0.45 : /\s/.test(ch) ? 0.3 : 0.75
  return Math.round(em * 1.06 * 100) / 100
}

function fmt(now: Date, opts: Intl.DateTimeFormatOptions, locale?: string): string | null {
  try {
    return new Intl.DateTimeFormat(locale, opts).format(now)
  } catch {
    return null // unknown time zone
  }
}

/** "2026-11-10" in a time zone (en-CA formats dates as ISO), comparable as text. */
function dayKey(now: Date, timeZone: string | undefined): string | null {
  try {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(now)
  } catch {
    return null
  }
}

export function ClockWidget({ block }: { block: BlockOf<"clock"> }) {
  const { timezone, hour12, showSeconds, showDate, greeting, greetingName, zones } = block.props
  // On the server (and while hydrating) the browser's locale and time zone come from its
  // cookie; afterwards the browser's own are used, so a changed setting shows at once.
  const seen = useLocaleContext()
  const [live, setLive] = useState(false)
  useEffect(() => setLive(true), [])
  const ctx = live ? null : seen
  const now = useNow(showSeconds ? 1000 : 60_000, seen !== null)
  const tz = timezone || ctx?.timeZone || undefined
  const loc = ctx?.locale

  const view = useMemo(() => {
    if (!now) return null
    const time = fmt(now, { hour: "2-digit", minute: "2-digit", second: showSeconds ? "2-digit" : undefined, hour12, timeZone: tz }, loc)
    const date = fmt(now, { weekday: "long", day: "numeric", month: "long", timeZone: tz }, loc)
    const hour = Number(fmt(now, { hour: "numeric", hourCycle: "h23", timeZone: tz }, loc) ?? now.getHours())
    const extra = zones.map((z) => ({
      label: z.label || cityOf(z.timezone),
      time: fmt(now, { hour: "2-digit", minute: "2-digit", hour12, timeZone: z.timezone || undefined }, loc) ?? "--:--",
      // "+1" when the other place is already on the next day (or "−1" on the previous one)
      day: (() => {
        const here = dayKey(now, tz)
        const there = dayKey(now, z.timezone || undefined)
        if (!here || !there || here === there) return ""
        return there > here ? "+1" : "−1"
      })(),
    }))
    return { time: time ?? "--:--", date: date ?? "Unknown time zone", hello: greetingFor(hour), extra }
  }, [now, hour12, showSeconds, tz, loc, zones])

  return (
    <div className="clock-root flex h-full flex-col px-5 py-3">
      {greeting && view && (
        <p className="clock-greeting truncate text-sm font-medium text-muted-foreground" suppressHydrationWarning>
          {view.hello}
          {greetingName.trim() && `, ${greetingName.trim()}`}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col justify-center [container-type:size]">
        <time
          suppressHydrationWarning
          dateTime={now?.toISOString()}
          className="leading-[0.9] font-[650] tracking-[-0.03em] whitespace-nowrap tabular-nums"
          // The block's height sets the size; the width only limits it when the time
          // would no longer fit (so widening a block doesn't make the time grow).
          style={{ fontSize: `clamp(1.25rem, min(62cqh, calc(100cqw / ${timeEms(view?.time)})), 7rem)` }}
        >
          {view?.time ?? " "}
        </time>
      </div>
      {showDate && (
        <div className="clock-date mt-1.5 truncate text-sm text-muted-foreground" suppressHydrationWarning>
          {view?.date}
          {timezone && <span className="opacity-70"> in {cityOf(timezone)}</span>}
        </div>
      )}
      {view && view.extra.length > 0 && (
        <ul className="clock-zones mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-x-4 gap-y-1 border-t pt-2.5">
          {view.extra.map((z, i) => (
            <li key={i} className="flex min-w-0 items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-muted-foreground">{z.label}</span>
              <span className="shrink-0 font-medium tabular-nums" suppressHydrationWarning>
                {z.time}
                {z.day && <sup className="ml-0.5 text-[0.65em] text-muted-foreground">{z.day}</sup>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function CalendarWidget({ block }: { block: BlockOf<"calendar"> }) {
  const mondayFirst = block.props.weekStart === "monday"
  // Like the clock: the server renders with the browser's locale and time zone from its
  // cookie, the browser takes over with its own after loading. On a first visit (no
  // cookie yet) the month appears after loading, so server and browser never disagree.
  const seen = useLocaleContext()
  const [live, setLive] = useState(false)
  useEffect(() => setLive(true), [])
  const ctx = live ? null : seen
  const now = useNow(60_000, seen !== null)
  const [offset, setOffset] = useState(0)
  const loc = ctx?.locale
  const tz = ctx?.timeZone

  const view = useMemo(() => {
    if (!now) return null
    // Today's date where the viewer is, then the month grid in plain calendar arithmetic (UTC).
    const [y, m, d] = (dayKey(now, tz) ?? dayKey(now, undefined)!).split("-").map(Number)
    const first = new Date(Date.UTC(y, m - 1 + offset, 1))
    const lead = (first.getUTCDay() + (mondayFirst ? 6 : 0)) % 7
    const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
    const thisMonth = first.getUTCFullYear() === y && first.getUTCMonth() === m - 1
    const cells: Array<{ day: number; today: boolean } | null> = Array.from({ length: lead }, () => null)
    for (let day = 1; day <= daysInMonth; day++) cells.push({ day, today: thisMonth && day === d })
    // 1 January 2024 was a Monday, 7 January a Sunday.
    const weekdays = Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat(loc, { weekday: "narrow", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, (mondayFirst ? 1 : 7) + i))),
    )
    return {
      title: new Intl.DateTimeFormat(loc, { month: "long", year: "numeric", timeZone: "UTC" }).format(first),
      cells,
      weekdays,
    }
  }, [now, offset, mondayFirst, loc, tz])

  if (!view) return <div className="h-full" aria-busy="true" />

  return (
    <div className="flex h-full flex-col px-4 pt-3 pb-4">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOffset(0)}
          className="text-base font-[650] tracking-[-0.01em]"
          title="Back to this month"
        >
          {view.title}
        </button>
        <div className="flex gap-0.5">
          <button type="button" aria-label="Previous month" onClick={() => setOffset((o) => o - 1)} className="rounded-md p-1 hover:bg-accent">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" aria-label="Next month" onClick={() => setOffset((o) => o + 1)} className="rounded-md p-1 hover:bg-accent">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-7 content-start gap-y-1 text-center text-sm" role="grid">
        {view.weekdays.map((w, i) => (
          <div key={i} className="pb-1 text-xs text-muted-foreground" role="columnheader">
            {w}
          </div>
        ))}
        {view.cells.map((c, i) => (
          <div key={i} className="grid place-items-center" role="gridcell">
            {c && (
              <span
                className={cn(
                  "grid size-7 place-items-center rounded-full tabular-nums",
                  c.today && "bg-primary font-semibold text-primary-foreground",
                )}
                aria-current={c.today ? "date" : undefined}
              >
                {c.day}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
