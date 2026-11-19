import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * ID generator that also works on plain-HTTP LAN origins, where
 * crypto.randomUUID() is unavailable (it requires a secure context).
 */
export function uid(len = 12): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  const bytes = new Uint8Array(len)
  globalThis.crypto.getRandomValues(bytes)
  let out = ""
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}

/** Blocks javascript:, data: and vbscript: links; everything else (http, https, smb, ssh, steam…) is allowed. */
export function isSafeHref(url: string): boolean {
  const trimmed = url.trim().toLowerCase().replace(/[\u0000-\u001f\s]/g, "")
  if (!trimmed) return false
  return !/^(javascript|data|vbscript):/.test(trimmed)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i >= 3 ? 1 : 0)} ${units[i]}`
}

export function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/**
 * `next`, but with every part that is deep-equal to the same part of `prev`
 * replaced by `prev`'s object. Untouched boards and blocks keep their identity,
 * so a change to one setting doesn't redraw the whole dashboard.
 */
export function keepEqual<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev
  if (typeof prev !== "object" || typeof next !== "object" || prev === null || next === null) return next
  if (Array.isArray(prev) !== Array.isArray(next)) return next
  if (Array.isArray(prev)) {
    const a = prev as unknown[]
    const b = next as unknown[]
    let same = a.length === b.length
    const out = b.map((v, i) => {
      const k = i < a.length ? keepEqual(a[i], v) : v
      if (k !== a[i]) same = false
      return k
    })
    return (same ? prev : out) as T
  }
  if (Object.getPrototypeOf(prev) !== Object.prototype || Object.getPrototypeOf(next) !== Object.prototype) return next
  const a = prev as Record<string, unknown>
  const b = next as Record<string, unknown>
  const keys = Object.keys(b)
  let same = keys.length === Object.keys(a).length
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    const k = Object.hasOwn(a, key) ? keepEqual(a[key], b[key]) : b[key]
    if (!Object.hasOwn(a, key) || k !== a[key]) same = false
    out[key] = k
  }
  return (same ? prev : out) as T
}
