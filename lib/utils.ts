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
