/**
 * The browser's locale and time zone, sent back in a small cookie (set by the
 * script that runs before the first paint), so the server can render the clock
 * as the browser would and it is on screen right away. Only formatting uses it;
 * every value is checked before use, anything odd is ignored.
 */
export const LOCALE_COOKIE = "td_locale"

export type LocaleContext = { locale: string; timeZone: string }

/** Script part that stores the browser's own formatting locale and time zone. */
export const LOCALE_SCRIPT = `try{var o=Intl.DateTimeFormat().resolvedOptions();document.cookie=${JSON.stringify(LOCALE_COOKIE + "=")}+encodeURIComponent(o.locale+"|"+o.timeZone)+";path=/;max-age=31536000;samesite=lax"}catch(e){}`

export function parseLocaleCookie(raw: string | undefined): LocaleContext | null {
  if (!raw || raw.length > 120) return null
  let value: string
  try {
    value = decodeURIComponent(raw)
  } catch {
    return null
  }
  const [locale, timeZone, ...rest] = value.split("|")
  if (rest.length || !locale || !timeZone || !/^[A-Za-z0-9-]{2,64}$/.test(locale) || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(timeZone)) return null
  try {
    const [canonical] = Intl.getCanonicalLocales(locale)
    // Throws for a time zone this runtime doesn't know.
    new Intl.DateTimeFormat(canonical, { timeZone }).format(0)
    return { locale: canonical, timeZone }
  } catch {
    return null
  }
}
