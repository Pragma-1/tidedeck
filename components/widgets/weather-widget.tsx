"use client"

import { useEffect, useState } from "react"
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
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
import type { BlockOf } from "@/lib/schema"

type Forecast = {
  current: {
    temperature_2m: number
    apparent_temperature: number
    relative_humidity_2m: number
    wind_speed_10m: number
    weather_code: number
    is_day: number
  }
  daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] }
}

function condition(code: number, day = true): { label: string; icon: LucideIcon } {
  if (code === 0) return { label: "Clear", icon: day ? Sun : Moon }
  if (code <= 2) return { label: "Partly cloudy", icon: day ? CloudSun : CloudMoon }
  if (code === 3) return { label: "Overcast", icon: Cloud }
  if (code <= 48) return { label: "Fog", icon: CloudFog }
  if (code <= 57) return { label: "Drizzle", icon: CloudDrizzle }
  if (code <= 67 || (code >= 80 && code <= 82)) return { label: "Rain", icon: CloudRain }
  if (code <= 77 || code === 85 || code === 86) return { label: "Snow", icon: CloudSnow }
  return { label: "Thunderstorm", icon: CloudLightning }
}

export function WeatherWidget({ block }: { block: BlockOf<"weather"> }) {
  const { latitude, longitude, units, forecastDays, place } = block.props
  const [data, setData] = useState<Forecast | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const params = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        current: "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day",
        daily: "weather_code,temperature_2m_max,temperature_2m_min",
        timezone: "auto",
        forecast_days: String(Math.max(forecastDays + 1, 1)),
        ...(units === "imperial" ? { temperature_unit: "fahrenheit", wind_speed_unit: "mph" } : {}),
      })
      try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
        if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`)
        const json = (await res.json()) as Forecast
        if (!cancelled) {
          setData(json)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof TypeError ? "Can’t reach open-meteo.com from this browser." : (e as Error).message)
      }
    }
    void load()
    const t = setInterval(load, 15 * 60_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [latitude, longitude, units, forecastDays])

  if (error && !data) return <p className="px-4 pb-4 text-sm text-muted-foreground">{error}</p>
  if (!data) return <div className="mx-4 mb-4 h-24 animate-pulse rounded-lg bg-muted/60" aria-label="Loading weather" />

  const now = condition(data.current.weather_code, data.current.is_day === 1)
  const unit = units === "imperial" ? "°F" : "°C"
  const speed = units === "imperial" ? "mph" : "km/h"
  const days = data.daily.time.slice(1, forecastDays + 1)

  return (
    <div className="flex h-full flex-col gap-3 px-4 pb-4">
      <div className="flex items-center gap-3">
        <now.icon className="size-11 shrink-0 text-primary" strokeWidth={1.5} aria-hidden />
        <div className="min-w-0">
          <div className="font-display text-4xl leading-none font-semibold tabular-nums">
            {Math.round(data.current.temperature_2m)}
            <span className="text-2xl text-muted-foreground">{unit}</span>
          </div>
          <div className="mt-1 truncate text-sm text-muted-foreground">
            {now.label} in {place}
          </div>
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <dt className="sr-only">Feels like</dt>
          <dd>Feels {Math.round(data.current.apparent_temperature)}°</dd>
        </div>
        <div className="flex items-center gap-1">
          <Wind className="size-3.5" aria-hidden />
          <dt className="sr-only">Wind</dt>
          <dd>
            {Math.round(data.current.wind_speed_10m)} {speed}
          </dd>
        </div>
        <div className="flex items-center gap-1">
          <Droplets className="size-3.5" aria-hidden />
          <dt className="sr-only">Humidity</dt>
          <dd>{data.current.relative_humidity_2m}%</dd>
        </div>
      </dl>
      {days.length > 0 && (
        <ul className="mt-auto grid gap-1 border-t pt-3" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((d, idx) => {
            const i = idx + 1
            const c = condition(data.daily.weather_code[i])
            return (
              <li key={d} className="flex flex-col items-center gap-1 text-center">
                <span className="text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(`${d}T12:00`))}
                </span>
                <c.icon className="size-5" strokeWidth={1.6} aria-label={c.label} />
                <span className="text-xs tabular-nums">
                  {Math.round(data.daily.temperature_2m_max[i])}°
                  <span className="text-muted-foreground"> {Math.round(data.daily.temperature_2m_min[i])}°</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
