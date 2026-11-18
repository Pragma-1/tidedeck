import { createHash, createPrivateKey, sign, type KeyObject } from "node:crypto"
import { z } from "zod"
import { readLimited } from "@/lib/server/http"
import { SOURCE_INFO, type Condition, type WeatherKeys, type WeatherReport, type WeatherSource } from "@/lib/weather"

/**
 * Loads the weather for a weather block from the chosen source, on the server:
 * keys never reach a browser, and every viewer shares one cached answer per
 * place, so a block costs at most one request round every 10 minutes.
 *
 * Requests go only to the fixed hosts below, never follow redirects (a key in
 * the address must not travel on), and messages shown to viewers never contain
 * the request address or anything the source sent back.
 */

export class WeatherError extends Error {}

export type WeatherQuery = {
  source: WeatherSource
  latitude: number
  longitude: number
  units: "metric" | "imperial"
  /** Forecast days after today (0–7). */
  days: number
  /** Time zone of the place (IANA), for sources that need one to cut the days. */
  timeZone: string
}

const ORIGINS: Record<WeatherSource, string> = {
  "open-meteo": "https://api.open-meteo.com",
  openweathermap: "https://api.openweathermap.org",
  weatherapi: "https://api.weatherapi.com",
  google: "https://weather.googleapis.com",
  apple: "https://weatherkit.apple.com",
}

/** For automated tests only: sends every request to a local stand-in instead (set by whoever runs the server). */
function origin(source: WeatherSource): string {
  const test = process.env.TIDEDECK_WEATHER_TEST_ORIGIN
  if (test && /^https?:\/\/[\w.:-]+$/.test(test)) return `${test}/${source}`
  return ORIGINS[source]
}

const TIMEOUT_MS = 10_000
const MAX_BYTES = 2 * 1024 * 1024
const CACHE_MS = 10 * 60_000
const FAILED_CACHE_MS = 60_000

async function getJson(source: WeatherSource, url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const name = SOURCE_INFO[source].name
  let res: Response
  try {
    res = await fetch(url, { headers: { accept: "application/json", ...headers }, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    const timeout = (err as Error).name === "TimeoutError"
    throw new WeatherError(timeout ? `${name} didn't answer in time.` : `The Tidedeck server can't reach ${name}.`)
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    if (res.status === 401 || res.status === 403) throw new WeatherError(`${name} refused the key. Check it in this block's settings.`)
    if (res.status === 429) throw new WeatherError(`${name}: too many requests. Try again later.`)
    if (res.status === 400 || res.status === 404) throw new WeatherError(`${name} has no weather for this place.`)
    throw new WeatherError(`${name} answered HTTP ${res.status}.`)
  }
  try {
    return JSON.parse((await readLimited(res as unknown as { body: AsyncIterable<Uint8Array> | null }, MAX_BYTES)).toString("utf8"))
  } catch {
    throw new WeatherError(`${name} sent an answer Tidedeck can't read.`)
  }
}

function parse<T>(source: WeatherSource, schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data)
  if (!r.success) throw new WeatherError(`${SOURCE_INFO[source].name} sent an answer Tidedeck can't read.`)
  return r.data
}

const num = z.number().finite()
const optNum = num.nullish()

// --- Units and dates -----------------------------------------------------------

const toF = (c: number) => (c * 9) / 5 + 32
const toC = (f: number) => ((f - 32) * 5) / 9
const kmhToMph = (v: number) => v / 1.609344
const mphToKmh = (v: number) => v * 1.609344

/** The calendar date (YYYY-MM-DD) of an instant in a time zone. */
function dateIn(timeZone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at)
}

/** The calendar date of an instant shifted by a UTC offset in seconds. */
const dateAtOffset = (unixSeconds: number, offsetSeconds: number) => new Date((unixSeconds + offsetSeconds) * 1000).toISOString().slice(0, 10)

const ymd = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`

function report(q: WeatherQuery, current: WeatherReport["current"], today: string, days: WeatherReport["days"]): WeatherReport {
  const seen = new Set<string>()
  const ahead = days
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.date > today && !seen.has(d.date) && seen.add(d.date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, q.days)
  return { source: q.source, units: q.units, current, days: ahead }
}

// --- Conditions ----------------------------------------------------------------

/** WMO weather codes (Open-Meteo). */
function wmo(code: number): Condition {
  if (code === 0) return "clear"
  if (code <= 2) return "partly"
  if (code === 3) return "cloudy"
  if (code <= 48) return "fog"
  if (code <= 55) return "drizzle"
  if (code <= 57) return "sleet"
  if (code <= 65 || (code >= 80 && code <= 82)) return "rain"
  if (code <= 67) return "sleet"
  if (code <= 77 || code === 85 || code === 86) return "snow"
  return "thunder"
}

/** OpenWeatherMap condition ids. */
function owm(id: number): Condition {
  if (id >= 200 && id < 300) return "thunder"
  if (id >= 300 && id < 400) return "drizzle"
  if (id === 511 || (id >= 611 && id <= 616)) return "sleet"
  if (id >= 500 && id < 600) return "rain"
  if (id >= 600 && id < 700) return "snow"
  if (id === 771 || id === 781) return "wind"
  if (id >= 700 && id < 800) return "fog"
  if (id === 800) return "clear"
  if (id === 801 || id === 802) return "partly"
  return "cloudy"
}

/** WeatherAPI.com condition codes. */
function weatherapi(code: number): Condition {
  if (code === 1000) return "clear"
  if (code === 1003) return "partly"
  if (code === 1006 || code === 1009) return "cloudy"
  if (code === 1030 || code === 1135 || code === 1147) return "fog"
  if (code === 1087 || (code >= 1273 && code <= 1282)) return "thunder"
  if (code === 1150 || code === 1153) return "drizzle"
  if ([1069, 1072, 1168, 1171, 1198, 1201, 1204, 1207, 1237, 1249, 1252, 1261, 1264].includes(code)) return "sleet"
  if (code === 1066 || code === 1114 || code === 1117 || (code >= 1210 && code <= 1225) || code === 1255 || code === 1258) return "snow"
  if (code === 1063 || (code >= 1180 && code <= 1195) || (code >= 1240 && code <= 1246)) return "rain"
  return "cloudy"
}

/** Google Weather condition types. */
function google(type: string): Condition {
  const t = type.toUpperCase()
  if (t === "CLEAR") return "clear"
  if (t === "MOSTLY_CLEAR" || t === "PARTLY_CLOUDY") return "partly"
  if (t === "MOSTLY_CLOUDY" || t === "CLOUDY") return "cloudy"
  if (t.includes("THUNDER")) return "thunder"
  if (t.includes("HAIL") || t === "RAIN_AND_SNOW") return "sleet"
  if (t.includes("SNOW")) return "snow"
  if (t.includes("RAIN") || t.includes("SHOWERS")) return "rain"
  if (t === "WINDY") return "wind"
  if (t.includes("FOG") || t.includes("HAZE")) return "fog"
  return "cloudy"
}

/** WeatherKit condition codes (WeatherCondition cases, capitalised). */
function apple(code: string): Condition {
  const c = code.toLowerCase()
  if (c === "clear" || c === "hot" || c === "frigid") return "clear"
  if (c === "mostlyclear" || c === "partlycloudy") return "partly"
  if (c === "cloudy" || c === "mostlycloudy") return "cloudy"
  if (c.includes("thunder") || c.includes("tropical") || c.includes("hurricane")) return "thunder"
  if (c.includes("sleet") || c.includes("freezing") || c.includes("hail") || c === "wintrymix") return "sleet"
  if (c.includes("snow") || c.includes("blizzard") || c.includes("flurries")) return "snow"
  if (c.includes("drizzle")) return "drizzle"
  if (c.includes("rain") || c.includes("showers")) return "rain"
  if (c === "windy" || c === "breezy") return "wind"
  if (c === "foggy" || c === "haze" || c === "smoky" || c.includes("dust")) return "fog"
  return "cloudy"
}

// --- Sources -------------------------------------------------------------------

const coords = (q: WeatherQuery) => ({ lat: q.latitude.toFixed(4), lon: q.longitude.toFixed(4) })

async function fromOpenMeteo(q: WeatherQuery): Promise<WeatherReport> {
  const params = new URLSearchParams({
    latitude: coords(q).lat,
    longitude: coords(q).lon,
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    timezone: "auto",
    forecast_days: String(q.days + 1),
    ...(q.units === "imperial" ? { temperature_unit: "fahrenheit", wind_speed_unit: "mph" } : {}),
  })
  const d = parse(
    q.source,
    z.object({
      current: z.object({
        time: z.string(),
        temperature_2m: num,
        apparent_temperature: optNum,
        relative_humidity_2m: optNum,
        wind_speed_10m: optNum,
        weather_code: num,
        is_day: num,
      }),
      daily: z.object({ time: z.array(z.string()), weather_code: z.array(num.nullable()), temperature_2m_max: z.array(num.nullable()), temperature_2m_min: z.array(num.nullable()) }),
    }),
    await getJson(q.source, `${origin(q.source)}/v1/forecast?${params}`),
  )
  const days: WeatherReport["days"] = []
  d.daily.time.forEach((date, i) => {
    const max = d.daily.temperature_2m_max[i]
    const min = d.daily.temperature_2m_min[i]
    const code = d.daily.weather_code[i]
    if (max != null && min != null && code != null) days.push({ date, max, min, condition: wmo(code) })
  })
  return report(
    q,
    {
      temperature: d.current.temperature_2m,
      feelsLike: d.current.apparent_temperature ?? null,
      humidity: d.current.relative_humidity_2m ?? null,
      wind: d.current.wind_speed_10m ?? null,
      condition: wmo(d.current.weather_code),
      day: d.current.is_day === 1,
    },
    d.current.time.slice(0, 10),
    days,
  )
}

async function fromOpenWeatherMap(q: WeatherQuery, apiKey: string): Promise<WeatherReport> {
  const base = new URLSearchParams({ lat: coords(q).lat, lon: coords(q).lon, units: q.units, appid: apiKey })
  const cond = z.array(z.object({ id: num, icon: z.string().optional() })).min(1)
  const [now, fc] = await Promise.all([
    getJson(q.source, `${origin(q.source)}/data/2.5/weather?${base}`),
    q.days > 0 ? getJson(q.source, `${origin(q.source)}/data/2.5/forecast?${base}`) : Promise.resolve(null),
  ])
  const c = parse(
    q.source,
    z.object({
      dt: num,
      timezone: num,
      main: z.object({ temp: num, feels_like: optNum, humidity: optNum }),
      wind: z.object({ speed: optNum }).optional(),
      weather: cond,
      sys: z.object({ sunrise: optNum, sunset: optNum }).optional(),
    }),
    now,
  )
  const wind = c.wind?.speed
  const icon = c.weather[0].icon ?? ""
  const day = icon ? icon.endsWith("d") : !!(c.sys?.sunrise && c.sys?.sunset && c.dt >= c.sys.sunrise && c.dt < c.sys.sunset)
  const days: WeatherReport["days"] = []
  if (fc) {
    const f = parse(
      q.source,
      z.object({
        city: z.object({ timezone: num }),
        list: z.array(z.object({ dt: num, main: z.object({ temp_min: num, temp_max: num }), weather: cond })),
      }),
      fc,
    )
    // The 3-hour steps of each local day: highest and lowest temperature, and the conditions around noon.
    const byDate = new Map<string, { max: number; min: number; noon: { gap: number; id: number } }>()
    for (const step of f.list) {
      const date = dateAtOffset(step.dt, f.city.timezone)
      const hour = new Date((step.dt + f.city.timezone) * 1000).getUTCHours()
      const gap = Math.abs(hour - 13)
      const d = byDate.get(date)
      if (!d) byDate.set(date, { max: step.main.temp_max, min: step.main.temp_min, noon: { gap, id: step.weather[0].id } })
      else {
        d.max = Math.max(d.max, step.main.temp_max)
        d.min = Math.min(d.min, step.main.temp_min)
        if (gap < d.noon.gap) d.noon = { gap, id: step.weather[0].id }
      }
    }
    for (const [date, d] of byDate) days.push({ date, max: d.max, min: d.min, condition: owm(d.noon.id) })
  }
  return report(
    q,
    {
      temperature: c.main.temp,
      feelsLike: c.main.feels_like ?? null,
      humidity: c.main.humidity ?? null,
      // m/s with metric units, mph with imperial ones.
      wind: wind == null ? null : q.units === "metric" ? wind * 3.6 : wind,
      condition: owm(c.weather[0].id),
      day,
    },
    dateAtOffset(c.dt, c.timezone),
    days,
  )
}

async function fromWeatherApi(q: WeatherQuery, apiKey: string): Promise<WeatherReport> {
  const params = new URLSearchParams({ key: apiKey, q: `${coords(q).lat},${coords(q).lon}`, days: String(q.days + 1), aqi: "no", alerts: "no" })
  const d = parse(
    q.source,
    z.object({
      location: z.object({ localtime: z.string() }),
      current: z.object({
        temp_c: num,
        temp_f: num,
        feelslike_c: optNum,
        feelslike_f: optNum,
        humidity: optNum,
        wind_kph: optNum,
        wind_mph: optNum,
        is_day: num,
        condition: z.object({ code: num }),
      }),
      forecast: z
        .object({
          forecastday: z.array(
            z.object({
              date: z.string(),
              day: z.object({ maxtemp_c: num, maxtemp_f: num, mintemp_c: num, mintemp_f: num, condition: z.object({ code: num }) }),
            }),
          ),
        })
        .optional(),
    }),
    await getJson(q.source, `${origin(q.source)}/v1/forecast.json?${params}`),
  )
  const m = q.units === "metric"
  const c = d.current
  return report(
    q,
    {
      temperature: m ? c.temp_c : c.temp_f,
      feelsLike: (m ? c.feelslike_c : c.feelslike_f) ?? null,
      humidity: c.humidity ?? null,
      wind: (m ? c.wind_kph : c.wind_mph) ?? null,
      condition: weatherapi(c.condition.code),
      day: c.is_day === 1,
    },
    d.location.localtime.slice(0, 10),
    (d.forecast?.forecastday ?? []).map((f) => ({
      date: f.date,
      max: m ? f.day.maxtemp_c : f.day.maxtemp_f,
      min: m ? f.day.mintemp_c : f.day.mintemp_f,
      condition: weatherapi(f.day.condition.code),
    })),
  )
}

const gTemp = z.object({ degrees: num, unit: z.string().optional() })
const gCondition = z.object({ type: z.string() })

async function fromGoogle(q: WeatherQuery, apiKey: string): Promise<WeatherReport> {
  const base = {
    key: apiKey,
    "location.latitude": coords(q).lat,
    "location.longitude": coords(q).lon,
    unitsSystem: q.units === "imperial" ? "IMPERIAL" : "METRIC",
  }
  const n = String(Math.min(10, q.days + 1))
  const [now, fc] = await Promise.all([
    getJson(q.source, `${origin(q.source)}/v1/currentConditions:lookup?${new URLSearchParams(base)}`),
    q.days > 0 ? getJson(q.source, `${origin(q.source)}/v1/forecast/days:lookup?${new URLSearchParams({ ...base, days: n, pageSize: n })}`) : Promise.resolve(null),
  ])
  // Values come with their unit: convert if it isn't the one asked for.
  const temp = (t: z.infer<typeof gTemp>) =>
    t.unit === "CELSIUS" && q.units === "imperial" ? toF(t.degrees) : t.unit === "FAHRENHEIT" && q.units === "metric" ? toC(t.degrees) : t.degrees
  const c = parse(
    q.source,
    z.object({
      currentTime: z.string(),
      timeZone: z.object({ id: z.string() }).optional(),
      isDaytime: z.boolean().optional(),
      weatherCondition: gCondition,
      temperature: gTemp,
      feelsLikeTemperature: gTemp.optional(),
      relativeHumidity: optNum,
      wind: z.object({ speed: z.object({ value: optNum, unit: z.string().optional() }).optional() }).optional(),
    }),
    now,
  )
  const speed = c.wind?.speed
  let wind: number | null = speed?.value ?? null
  if (wind != null && speed?.unit === "KILOMETERS_PER_HOUR" && q.units === "imperial") wind = kmhToMph(wind)
  if (wind != null && speed?.unit === "MILES_PER_HOUR" && q.units === "metric") wind = mphToKmh(wind)
  const zone = validZone(c.timeZone?.id) ?? q.timeZone
  const days: WeatherReport["days"] = []
  if (fc) {
    const f = parse(
      q.source,
      z.object({
        forecastDays: z
          .array(
            z.object({
              displayDate: z.object({ year: num, month: num, day: num }),
              maxTemperature: gTemp,
              minTemperature: gTemp,
              daytimeForecast: z.object({ weatherCondition: gCondition }).optional(),
              nighttimeForecast: z.object({ weatherCondition: gCondition }).optional(),
            }),
          )
          .default([]),
      }),
      fc,
    )
    for (const d of f.forecastDays) {
      const type = d.daytimeForecast?.weatherCondition.type ?? d.nighttimeForecast?.weatherCondition.type ?? "CLOUDY"
      days.push({ date: ymd(d.displayDate.year, d.displayDate.month, d.displayDate.day), max: temp(d.maxTemperature), min: temp(d.minTemperature), condition: google(type) })
    }
  }
  const at = new Date(c.currentTime)
  return report(
    q,
    {
      temperature: temp(c.temperature),
      feelsLike: c.feelsLikeTemperature ? temp(c.feelsLikeTemperature) : null,
      humidity: c.relativeHumidity ?? null,
      wind,
      condition: google(c.weatherCondition.type),
      day: c.isDaytime ?? true,
    },
    dateIn(zone, Number.isNaN(at.getTime()) ? new Date() : at),
    days,
  )
}

// WeatherKit authenticates with a short-lived token signed by the developer's key (ES256).
const tokens = new Map<string, { token: string; until: number }>()

function appleToken(k: NonNullable<WeatherKeys["apple"]>): string {
  const id = `${k.teamId}.${k.serviceId}.${k.keyId}`
  const hit = tokens.get(id)
  const now = Math.floor(Date.now() / 1000)
  if (hit && hit.until > now + 60) return hit.token
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
  const head = b64({ alg: "ES256", kid: k.keyId, id: `${k.teamId}.${k.serviceId}` })
  const body = b64({ iss: k.teamId, iat: now, exp: now + 3600, sub: k.serviceId })
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key: appleKey(k.privateKey), dsaEncoding: "ieee-p1363" }).toString("base64url")
  const token = `${head}.${body}.${sig}`
  tokens.clear()
  tokens.set(id, { token, until: now + 3600 })
  return token
}

/** The WeatherKit private key (.p8, a P-256 key in PEM). Throws a readable message if it isn't one. */
export function appleKey(pem: string): KeyObject {
  let key: KeyObject
  try {
    key = createPrivateKey({ key: pem, format: "pem" })
  } catch {
    throw new WeatherError("That isn't a readable private key. Paste the whole .p8 file, including the BEGIN and END lines.")
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1")
    throw new WeatherError("WeatherKit keys are P-256 (ES256) keys; this one is a different kind.")
  return key
}

async function fromApple(q: WeatherQuery, k: NonNullable<WeatherKeys["apple"]>): Promise<WeatherReport> {
  const params = new URLSearchParams({ dataSets: "currentWeather,forecastDaily", timezone: q.timeZone })
  const d = parse(
    q.source,
    z.object({
      currentWeather: z.object({
        asOf: z.string().optional(),
        temperature: num,
        temperatureApparent: optNum,
        humidity: optNum,
        windSpeed: optNum,
        conditionCode: z.string(),
        daylight: z.boolean().optional(),
      }),
      forecastDaily: z
        .object({ days: z.array(z.object({ forecastStart: z.string(), conditionCode: z.string(), temperatureMax: num, temperatureMin: num })) })
        .optional(),
    }),
    await getJson(q.source, `${origin(q.source)}/api/v1/weather/en/${coords(q).lat}/${coords(q).lon}?${params}`, {
      authorization: `Bearer ${appleToken(k)}`,
    }),
  )
  // WeatherKit answers in metric units, humidity as a fraction.
  const t = (c: number) => (q.units === "imperial" ? toF(c) : c)
  const c = d.currentWeather
  const asOf = c.asOf ? new Date(c.asOf) : new Date()
  return report(
    q,
    {
      temperature: t(c.temperature),
      feelsLike: c.temperatureApparent == null ? null : t(c.temperatureApparent),
      humidity: c.humidity == null ? null : c.humidity <= 1 ? c.humidity * 100 : c.humidity,
      wind: c.windSpeed == null ? null : q.units === "imperial" ? kmhToMph(c.windSpeed) : c.windSpeed,
      condition: apple(c.conditionCode),
      day: c.daylight ?? true,
    },
    dateIn(q.timeZone, Number.isNaN(asOf.getTime()) ? new Date() : asOf),
    (d.forecastDaily?.days ?? []).flatMap((day) => {
      const start = new Date(day.forecastStart)
      if (Number.isNaN(start.getTime())) return []
      // The day starts at local midnight; an hour later is safely the same date.
      return [{ date: dateIn(q.timeZone, new Date(start.getTime() + 3600_000)), max: t(day.temperatureMax), min: t(day.temperatureMin), condition: apple(day.conditionCode) }]
    }),
  )
}

// --- Entry point -----------------------------------------------------------------

/** An IANA time zone this server knows, or null. */
export function validZone(tz: unknown): string | null {
  if (typeof tz !== "string" || !tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return null
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz })
    return tz
  } catch {
    return null
  }
}

/**
 * A fixed-offset zone near the place, for places saved before their time zone was
 * stored (choosing the place again stores the exact one). Etc/GMT signs are inverted.
 */
export function zoneFromLongitude(longitude: number): string {
  const h = Math.max(-12, Math.min(14, Math.round(longitude / 15)))
  return h === 0 ? "Etc/GMT" : `Etc/GMT${h > 0 ? "-" : "+"}${Math.abs(h)}`
}

function load(q: WeatherQuery, keys: WeatherKeys): Promise<WeatherReport> {
  const missing = () => Promise.reject(new WeatherError(`Add the ${SOURCE_INFO[q.source].name} key in this block's settings.`))
  switch (q.source) {
    case "open-meteo":
      return fromOpenMeteo(q)
    case "openweathermap":
      return keys.openweathermap ? fromOpenWeatherMap(q, keys.openweathermap.apiKey) : missing()
    case "weatherapi":
      return keys.weatherapi ? fromWeatherApi(q, keys.weatherapi.apiKey) : missing()
    case "google":
      return keys.google ? fromGoogle(q, keys.google.apiKey) : missing()
    case "apple":
      return keys.apple ? fromApple(q, keys.apple) : missing()
  }
}

const g = globalThis as unknown as { __tidedeckWeather?: Map<string, { at: number; ok: boolean; value: Promise<WeatherReport> }> }
const cache = (g.__tidedeckWeather ??= new Map())

/** A fingerprint of the credentials, so a changed key doesn't get an answer cached for the old one. */
function keyStamp(source: WeatherSource, keys: WeatherKeys): string {
  const k = SOURCE_INFO[source].keyed
  const v = k ? keys[k] : undefined
  if (!v) return "-"
  return createHash("sha256").update(JSON.stringify(v)).digest("base64url").slice(0, 16)
}

export function getWeather(q: WeatherQuery, keys: WeatherKeys, fresh = false): Promise<WeatherReport> {
  const id = [q.source, q.latitude.toFixed(4), q.longitude.toFixed(4), q.units, q.days, q.timeZone, keyStamp(q.source, keys)].join("|")
  const now = Date.now()
  const hit = cache.get(id)
  if (!fresh && hit && now - hit.at < (hit.ok ? CACHE_MS : FAILED_CACHE_MS)) return hit.value
  const entry = { at: now, ok: true, value: load(q, keys) }
  entry.value.catch(() => {
    entry.ok = false
  })
  cache.set(id, entry)
  if (cache.size > 300) for (const [k, v] of cache) if (now - v.at > CACHE_MS) cache.delete(k)
  return entry.value
}
