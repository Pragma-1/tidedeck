import { DE } from "./i18n-de";

export type Lang = "de" | "en";
export const LANGS: readonly Lang[] = ["de", "en"];
export const isLang = (v: unknown): v is Lang => v === "de" || v === "en";
export type Params = Record<string, string | number>;

/*
 * Keys are the English texts themselves, so English needs no dictionary and a missing German
 * entry degrades to readable English. Placeholders look like {name}. Messages that were already
 * formatted (e.g. thrown errors) are matched against the placeholder patterns, so
 * "Use at least 12 characters." still finds "Use at least {n} characters.".
 */
const PLACEHOLDER = /\{(\w+)\}/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(DE)
  .filter(([k]) => k.includes("{"))
  .map(([k, v]) => {
    const names: string[] = [];
    const src = k
      .split(PLACEHOLDER)
      .map((part, i) => (i % 2 ? (names.push(part), "([\\s\\S]+?)") : escapeRe(part)))
      .join("");
    return { re: new RegExp(`^${src}$`), names, de: v };
  });

const fill = (s: string, p?: Params) => (p ? s.replace(PLACEHOLDER, (m, k: string) => (k in p ? String(p[k]) : m)) : s);

export function translate(lang: Lang, text: string, params?: Params): string {
  if (lang === "en") return fill(text, params);
  const exact = DE[text];
  if (exact !== undefined)
    return fill(
      exact,
      params &&
        Object.fromEntries(
          Object.entries(params).map(([k, v]) => [k, typeof v === "string" && DE[v] !== undefined ? DE[v] : v]),
        ),
    );
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (m) return fill(p.de, Object.fromEntries(p.names.map((n, i) => [n, DE[m[i + 1]] ?? m[i + 1]])));
  }
  return fill(text, params);
}

export type T = (text: string, params?: Params) => string;
export const makeT =
  (lang: Lang): T =>
  (text, params) =>
    translate(lang, text, params);

const LOCALES: Record<Lang, string> = { de: "de-DE", en: "en-GB" };
/** Server time zone (WIKI_TIMEZONE). The client receives it from the layout, so both render identical text. */
export const serverTimeZone = () => (typeof process !== "undefined" && process.env?.WIKI_TIMEZONE) || "UTC";
export function formatDate(ts: number, lang: Lang, withSeconds = false, timeZone: string = serverTimeZone()): string {
  try {
    return new Intl.DateTimeFormat(LOCALES[lang], {
      dateStyle: "medium",
      timeStyle: withSeconds ? "medium" : "short",
      timeZone,
    }).format(new Date(ts * 1000));
  } catch {
    return new Date(ts * 1000).toISOString();
  }
}

/** "in 3 h 20 min" style durations, rounded up to whole minutes. */
export function formatDuration(sec: number, lang: Lang): string {
  const m = Math.max(1, Math.ceil(sec / 60));
  const h = Math.floor(m / 60),
    r = m % 60;
  if (h === 0) return `${m} min`;
  return r ? `${h} ${lang === "de" ? "Std." : "h"} ${r} min` : `${h} ${lang === "de" ? "Std." : "h"}`;
}
