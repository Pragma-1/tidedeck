import type { NextRequest } from "next/server"
import { findBlock } from "@/lib/schema"
import { canView } from "@/lib/server/auth"
import { fail, json } from "@/lib/server/http"
import { getWeatherKeys } from "@/lib/server/secrets"
import { getConfig } from "@/lib/server/store"
import { WeatherError, getWeather, validZone, zoneFromLongitude } from "@/lib/server/weather"

export const dynamic = "force-dynamic"

/** The weather of one weather block, from its source (place, units and source come from the stored block, never the request). */
export async function GET(req: NextRequest) {
  if (!(await canView(req))) return fail(401, "Sign in to view this dashboard")
  const { config } = await getConfig()
  const block = findBlock(config, req.nextUrl.searchParams.get("block") ?? "")
  if (block?.type !== "weather") return fail(404, "Weather block not found")
  const p = block.props
  // Only Apple's source needs one. Never the viewer's: every distinct zone would be another
  // upstream request, so a visitor could use up the key's quota by changing a cookie.
  const timeZone = validZone(p.timezone) ?? zoneFromLongitude(p.longitude)
  try {
    const report = await getWeather(
      { source: p.source, latitude: p.latitude, longitude: p.longitude, units: p.units, days: p.forecastDays, timeZone },
      await getWeatherKeys(),
    )
    // What it was made for, so a browser with newer (not yet saved) settings asks again.
    return json({ ...report, asked: { latitude: p.latitude, longitude: p.longitude, days: p.forecastDays } })
  } catch (err) {
    if (err instanceof WeatherError) return fail(502, err.message)
    console.error("[tidedeck] weather", (err as Error).name)
    return fail(500, "The weather couldn't be loaded.")
  }
}
