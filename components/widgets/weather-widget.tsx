"use client"

import { useEffect, useState } from "react"
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Moon,
  Sun,
  Wind,
  type LucideIcon,
} from "lucide-react"
import { usePolling } from "@/hooks/use-polling"
import type { BlockOf } from "@/lib/schema"
import { SOURCE_INFO, WEATHER_KEYS_EVENT, type Condition, type WeatherReport } from "@/lib/weather"

type Answer = WeatherReport & { asked: { latitude: number; longitude: number; days: number } }

function condition(c: Condition, day = true): { label: string; icon: LucideIcon } {
  switch (c) {
    case "clear":
      return { label: "Clear", icon: day ? Sun : Moon }
    case "partly":
      return { label: "Partly cloudy", icon: day ? CloudSun : CloudMoon }
    case "cloudy":
      return { label: "Cloudy", icon: Cloud }
    case "fog":
      return { label: "Fog", icon: CloudFog }
    case "drizzle":
      return { label: "Drizzle", icon: CloudDrizzle }
    case "rain":
      return { label: "Rain", icon: CloudRain }
    case "sleet":
      return { label: "Sleet", icon: CloudHail }
    case "snow":
      return { label: "Snow", icon: CloudSnow }
    case "thunder":
      return { label: "Thunderstorm", icon: CloudLightning }
    case "wind":
      return { label: "Windy", icon: Wind }
  }
}

export function WeatherWidget({ block }: { block: BlockOf<"weather"> }) {
  const { latitude, longitude, units, forecastDays, place, source, timezone } = block.props
  // A key saved in the settings: load again at once.
  const [keys, setKeys] = useState(0)
  useEffect(() => {
    const bump = () => setKeys((n) => n + 1)
    window.addEventListener(WEATHER_KEYS_EVENT, bump)
    return () => window.removeEventListener(WEATHER_KEYS_EVENT, bump)
  }, [])
  // The address changes with the settings, so new settings load at once.
  const key = [source, latitude, longitude, units, forecastDays, timezone, keys].join("|")
  const { data, error } = usePolling<Answer>(
    `/api/weather?block=${encodeURIComponent(block.id)}&k=${encodeURIComponent(key)}`,
    15 * 60_000,
    (a) => a.source === source && a.units === units && a.asked?.latitude === latitude && a.asked?.longitude === longitude && a.asked?.days === forecastDays,
  )

  if (error && !data) return <p className="px-4 pb-4 text-sm text-muted-foreground">{error}</p>
  if (!data) return <div className="mx-4 mb-4 h-24 animate-pulse rounded-lg bg-muted/60" aria-label="Loading weather" />

  const now = condition(data.current.condition, data.current.day)
  const unit = units === "imperial" ? "°F" : "°C"
  const speed = units === "imperial" ? "mph" : "km/h"
  const days = data.days.slice(0, forecastDays)
  const credit = SOURCE_INFO[data.source]?.credit

  return (
    <div className="flex h-full flex-col gap-3 px-4 pb-4">
      <div className="flex items-center gap-3">
        <now.icon className="size-11 shrink-0 text-primary" strokeWidth={1.5} aria-hidden />
        <div className="min-w-0">
          <div className="text-4xl leading-none font-[650] tracking-[-0.02em] tabular-nums">
            {Math.round(data.current.temperature)}
            <span className="text-2xl text-muted-foreground">{unit}</span>
          </div>
          <div className="mt-1 truncate text-sm text-muted-foreground">
            {now.label} in {place}
          </div>
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {data.current.feelsLike != null && (
          <div className="flex items-center gap-1">
            <dt className="sr-only">Feels like</dt>
            <dd>Feels {Math.round(data.current.feelsLike)}°</dd>
          </div>
        )}
        {data.current.wind != null && (
          <div className="flex items-center gap-1">
            <Wind className="size-3.5" aria-hidden />
            <dt className="sr-only">Wind</dt>
            <dd>
              {Math.round(data.current.wind)} {speed}
            </dd>
          </div>
        )}
        {data.current.humidity != null && (
          <div className="flex items-center gap-1">
            <Droplets className="size-3.5" aria-hidden />
            <dt className="sr-only">Humidity</dt>
            <dd>{Math.round(data.current.humidity)}%</dd>
          </div>
        )}
      </dl>
      {days.length > 0 && (
        <ul className="mt-auto grid gap-1 border-t pt-3" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((d) => {
            const c = condition(d.condition)
            return (
              <li key={d.date} className="flex flex-col items-center gap-1 text-center">
                <span className="text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(`${d.date}T12:00`))}
                </span>
                <c.icon className="size-5" strokeWidth={1.6} aria-label={c.label} />
                <span className="text-xs tabular-nums">
                  {Math.round(d.max)}°<span className="text-muted-foreground"> {Math.round(d.min)}°</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {credit && (
        <p
          className={`flex flex-wrap gap-x-2.5 text-[0.6875rem] text-muted-foreground ${days.length > 0 ? "-mt-1.5" : "mt-auto"}`}
          translate="no"
        >
          {credit.href ? (
            <a href={credit.href} target="_blank" rel="noopener noreferrer" className="no-drag hover:underline">
              {credit.text}
            </a>
          ) : (
            credit.text
          )}
          {credit.extra && (
            <a href={credit.extra.href} target="_blank" rel="noopener noreferrer" className="no-drag hover:underline">
              {credit.extra.text}
            </a>
          )}
        </p>
      )}
    </div>
  )
}
