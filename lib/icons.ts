export const DASHBOARD_ICONS_CDN = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons"
export const SELFHST_CDN = "https://cdn.jsdelivr.net/gh/selfhst/icons"
const SELFHST_INDEX = "https://raw.githubusercontent.com/selfhst/icons/main/index.json"

export type IconLibrary = "dashboard-icons" | "selfhst"

const slugify = (v: string) => v.toLowerCase().replace(/\.(png|svg|webp)$/, "").replace(/[^a-z0-9._-]/g, "")

/**
 * The icon field of an app accepts:
 *  - "sh:immich" / "sh:immich-light"   an icon from selfh.st/icons
 *  - "di:proxmox" or just "proxmox"     an icon from dashboard-icons
 *  - https://…                          any image on the web
 *  - /api/icons/…                       a file uploaded to this Tidedeck
 *  - empty                              the app's own favicon
 */
export function resolveIcon(icon: string, appUrl: string): string | null {
  const v = icon.trim()
  if (v) {
    if (/^https?:\/\//i.test(v) || v.startsWith("/")) return v
    if (v.startsWith("sh:")) {
      const slug = slugify(v.slice(3))
      return slug ? `${SELFHST_CDN}/png/${slug}.png` : null
    }
    const slug = slugify(v.startsWith("di:") ? v.slice(3) : v)
    return slug ? `${DASHBOARD_ICONS_CDN}/png/${slug}.png` : null
  }
  try {
    const u = new URL(appUrl)
    if (u.protocol === "http:" || u.protocol === "https:") return `${u.origin}/favicon.ico`
  } catch {}
  return null
}

/** Which library an icon value comes from, and its bare name. */
export function parseIcon(icon: string): { kind: IconLibrary | "url" | "upload" | "favicon"; name: string } {
  const v = icon.trim()
  if (!v) return { kind: "favicon", name: "" }
  if (v.startsWith("/api/icons/")) return { kind: "upload", name: v }
  if (/^https?:\/\//i.test(v) || v.startsWith("/")) return { kind: "url", name: v }
  if (v.startsWith("sh:")) return { kind: "selfhst", name: v.slice(3) }
  return { kind: "dashboard-icons", name: v.startsWith("di:") ? v.slice(3) : v }
}

export type IconEntry = { name: string; label: string; light: boolean; dark: boolean }

export const iconPreview = (lib: IconLibrary, name: string) =>
  lib === "selfhst" ? `${SELFHST_CDN}/png/${name}.png` : `${DASHBOARD_ICONS_CDN}/png/${name}.png`

const cache = new Map<IconLibrary, Promise<IconEntry[]>>()

/** Name lists of both libraries, loaded once per session straight from their repos. */
export function loadIconIndex(lib: IconLibrary): Promise<IconEntry[]> {
  const hit = cache.get(lib)
  if (hit) return hit
  const p =
    lib === "selfhst"
      ? fetch(SELFHST_INDEX)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((list: Array<{ Name: string; Reference: string; Light?: string; Dark?: string; PNG?: string }>) =>
            list
              .filter((x) => x.Reference && x.PNG !== "No")
              .map((x) => ({ name: x.Reference, label: x.Name, light: x.Light === "Yes", dark: x.Dark === "Yes" })),
          )
      : fetch(`${DASHBOARD_ICONS_CDN}/tree.json`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((tree: { png?: string[] }) => {
            const names = new Set((tree.png ?? []).map((f) => f.replace(/\.png$/, "")))
            // Fold "-light"/"-dark" files into variants of their base icon.
            return [...names]
              .filter((n) => !/-(light|dark)$/.test(n))
              .map((n) => ({ name: n, label: n, light: names.has(`${n}-light`), dark: names.has(`${n}-dark`) }))
          })
  const guarded = p.catch(() => {
    cache.delete(lib)
    return [] as IconEntry[]
  })
  cache.set(lib, guarded)
  return guarded
}
