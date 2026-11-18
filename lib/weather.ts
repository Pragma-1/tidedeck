/**
 * Weather sources a weather block can use. Shared by the server (which loads the
 * weather) and the browser (settings and the block itself), so nothing here is secret.
 */

export const WEATHER_SOURCES = ["open-meteo", "openweathermap", "weatherapi", "google", "apple"] as const
export type WeatherSource = (typeof WEATHER_SOURCES)[number]

/** Sources that need credentials, and the credentials each needs. */
export type WeatherKeys = {
  openweathermap?: { apiKey: string }
  weatherapi?: { apiKey: string }
  google?: { apiKey: string }
  apple?: { teamId: string; serviceId: string; keyId: string; privateKey: string }
}
export type KeyedSource = keyof WeatherKeys

export type SourceInfo = {
  name: string
  /** Credentials needed (null: none). */
  keyed: KeyedSource | null
  /** Most forecast days this source can give (after today). */
  maxDays: number
  /** Where to get the key or set the source up. */
  signup?: string
  /** Shown under the forecast, as the source's terms ask. */
  credit?: { text: string; href?: string; extra?: { text: string; href: string } }
  hint: string
}

export const SOURCE_INFO: Record<WeatherSource, SourceInfo> = {
  "open-meteo": {
    name: "Open-Meteo",
    keyed: null,
    maxDays: 7,
    hint: "Free, no key needed.",
  },
  openweathermap: {
    name: "OpenWeatherMap",
    keyed: "openweathermap",
    maxDays: 4,
    signup: "https://home.openweathermap.org/api_keys",
    credit: { text: "OpenWeatherMap", href: "https://openweathermap.org/" },
    hint: "Needs an API key (the free plan works). Forecast up to 4 days. A new key can take a couple of hours to start working.",
  },
  weatherapi: {
    name: "WeatherAPI.com",
    keyed: "weatherapi",
    maxDays: 7,
    signup: "https://www.weatherapi.com/my/",
    credit: { text: "WeatherAPI.com", href: "https://www.weatherapi.com/" },
    hint: "Needs an API key. The free plan forecasts 2 days ahead, paid plans more.",
  },
  google: {
    name: "Google Weather",
    keyed: "google",
    maxDays: 7,
    signup: "https://console.cloud.google.com/google/maps-apis/api-list",
    credit: { text: "Includes weather data from Google Maps" },
    hint: "Needs a Google Maps Platform API key with the Weather API enabled (billing account required; a monthly free amount applies).",
  },
  apple: {
    name: "Apple Weather",
    keyed: "apple",
    maxDays: 7,
    signup: "https://developer.apple.com/account/resources/authkeys/list",
    credit: {
      text: "Apple Weather",
      href: "https://weather.apple.com/",
      extra: { text: "Other data sources", href: "https://developer.apple.com/weatherkit/data-source-attribution/" },
    },
    hint: "WeatherKit needs an Apple Developer Program membership: a WeatherKit key (.p8), its Key ID, your Team ID and a Services ID.",
  },
}

/** Sent on window when a weather key was saved or removed, so weather blocks load again. */
export const WEATHER_KEYS_EVENT = "tidedeck:weather-keys"

/** Simplified conditions every source is mapped to (they decide the icon and label). */
export type Condition = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "sleet" | "snow" | "thunder" | "wind"

export type WeatherReport = {
  source: WeatherSource
  units: "metric" | "imperial"
  current: {
    temperature: number
    feelsLike: number | null
    humidity: number | null
    wind: number | null
    condition: Condition
    day: boolean
  }
  /** Days after today, in order, as many as asked for (or the source has). */
  days: { date: string; max: number; min: number; condition: Condition }[]
}
