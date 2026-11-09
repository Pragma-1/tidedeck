"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { BlockOf } from "@/lib/schema"
import { cn } from "@/lib/utils"

function useNow(intervalMs: number) {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export function ClockWidget({ block }: { block: BlockOf<"clock"> }) {
  const { timezone, hour12, showSeconds, showDate } = block.props
  const now = useNow(showSeconds ? 1000 : 5000)
  const tz = timezone || undefined

  const [time, date] = useMemo(() => {
    if (!now) return ["", ""]
    try {
      const t = new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: showSeconds ? "2-digit" : undefined,
        hour12,
        timeZone: tz,
      }).format(now)
      const d = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(now)
      return [t, d]
    } catch {
      return ["--:--", "Unknown time zone"]
    }
  }, [now, hour12, showSeconds, tz])

  return (
    <div className="flex h-full flex-col justify-center px-5 [container-type:size]">
      <time
        dateTime={now?.toISOString()}
        className="font-display leading-[0.9] font-semibold tracking-tight tabular-nums"
        style={{ fontSize: "clamp(1.5rem, min(52cqh, 17cqw), 7rem)" }}
      >
        {time || " "}
      </time>
      {showDate && (
        <div className="mt-1.5 truncate text-sm text-muted-foreground">
          {date}
          {timezone && <span className="opacity-70"> in {timezone.split("/").pop()?.replace(/_/g, " ")}</span>}
        </div>
      )}
    </div>
  )
}

export function CalendarWidget({ block }: { block: BlockOf<"calendar"> }) {
  const mondayFirst = block.props.weekStart === "monday"
  const now = useNow(60_000)
  const [offset, setOffset] = useState(0)

  const view = useMemo(() => {
    const base = now ?? new Date()
    const first = new Date(base.getFullYear(), base.getMonth() + offset, 1)
    const lead = (first.getDay() + (mondayFirst ? 6 : 0)) % 7
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    const cells: Array<{ day: number; today: boolean } | null> = Array.from({ length: lead }, () => null)
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        day: d,
        today:
          !!now && d === now.getDate() && first.getMonth() === now.getMonth() && first.getFullYear() === now.getFullYear(),
      })
    }
    const weekdays = Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(new Date(2024, 0, (mondayFirst ? 1 : 7) + i)),
    )
    return {
      title: new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(first),
      cells,
      weekdays,
    }
  }, [now, offset, mondayFirst])

  return (
    <div className="flex h-full flex-col px-4 pt-3 pb-4">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOffset(0)}
          className="font-display text-base font-semibold"
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
