import type { NextRequest } from "next/server"
import { findBlock } from "@/lib/schema"
import { canEdit } from "@/lib/server/auth"
import { fail, isTrustedMutation, json, readJson } from "@/lib/server/http"
import { getWeatherKeys, setWeatherKey } from "@/lib/server/secrets"
import { getConfig } from "@/lib/server/store"
import { WeatherError, appleKey, getWeather, validZone, zoneFromLongitude } from "@/lib/server/weather"
import type { KeyedSource, WeatherKeys } from "@/lib/weather"

export const dynamic = "force-dynamic"

const KEYED: KeyedSource[] = ["openweathermap", "weatherapi", "google", "apple"]
const API_KEY = /^[\x21-\x7e]{8,256}$/
const APPLE_ID = /^[A-Z0-9]{10}$/
const SERVICE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{0,199}$/

/** Which weather keys are saved. The keys themselves never leave the server; only Apple's (non-secret) ids are shown again. */
export async function GET(req: NextRequest) {
  if (!(await canEdit(req))) return fail(401, "Sign in to edit")
  const k = await getWeatherKeys()
  return json({
    openweathermap: !!k.openweathermap,
    weatherapi: !!k.weatherapi,
    google: !!k.google,
    apple: k.apple ? { teamId: k.apple.teamId, serviceId: k.apple.serviceId, keyId: k.apple.keyId } : null,
  })
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")

/** Saves a source's key after trying it on a real request, or removes it. */
export async function POST(req: NextRequest) {
  if (!isTrustedMutation(req)) return fail(403, "Request rejected")
  if (!(await canEdit(req))) return fail(401, "Sign in to edit")
  const body = (await readJson<Record<string, unknown>>(req, 20_000)) ?? {}
  const source = body.source as KeyedSource
  if (!KEYED.includes(source)) return fail(400, "Unknown weather source")

  if (body.remove === true) {
    await setWeatherKey(source, null)
    return json({ ok: true })
  }

  const saved = await getWeatherKeys()
  let value: WeatherKeys[KeyedSource]
  if (source === "apple") {
    const teamId = str(body.teamId, 20).toUpperCase()
    const keyId = str(body.keyId, 20).toUpperCase()
    const serviceId = str(body.serviceId, 200)
    // An empty key field keeps the saved key, so it never has to travel back to the browser.
    const privateKey = str(body.privateKey, 4000) || saved.apple?.privateKey || ""
    if (!APPLE_ID.test(teamId)) return fail(400, "The Team ID is 10 letters and digits.")
    if (!APPLE_ID.test(keyId)) return fail(400, "The Key ID is 10 letters and digits.")
    if (!SERVICE_ID.test(serviceId)) return fail(400, "Enter the Services ID, e.g. com.example.weather.")
    if (!privateKey) return fail(400, "Paste the WeatherKit private key (.p8 file).")
    try {
      appleKey(privateKey)
    } catch (err) {
      return fail(400, (err as Error).message)
    }
    value = { teamId, keyId, serviceId, privateKey }
  } else {
    const apiKey = str(body.apiKey, 300)
    if (!API_KEY.test(apiKey)) return fail(400, "Enter the API key (no spaces).")
    value = { apiKey }
  }

  // Try it where the block is (or anywhere, if it isn't saved yet).
  const { config } = await getConfig()
  const block = typeof body.block === "string" ? findBlock(config, body.block) : null
  const p = block?.type === "weather" ? block.props : null
  try {
    await getWeather(
      {
        source,
        latitude: p?.latitude ?? 52.52,
        longitude: p?.longitude ?? 13.405,
        units: p?.units ?? "metric",
        days: 1,
        timeZone: validZone(p?.timezone) ?? zoneFromLongitude(p?.longitude ?? 13.405),
      },
      { [source]: value },
      true,
    )
  } catch (err) {
    if (err instanceof WeatherError) return fail(400, err.message)
    console.error("[tidedeck] weather key test", (err as Error).name)
    return fail(500, "The key couldn't be tried.")
  }
  await setWeatherKey(source, value)
  return json({ ok: true })
}
