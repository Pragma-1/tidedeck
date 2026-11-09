import { NextResponse, type NextRequest } from "next/server"

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "cache-control": "no-store" } })

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  json({ error, ...extra }, status)

/**
 * CSRF guard for state-changing requests: the browser must send JSON
 * (forces a CORS preflight cross-origin) and, when present, an Origin
 * matching the Host the request came in on.
 */
export function isTrustedMutation(req: NextRequest): boolean {
  if (!req.headers.get("content-type")?.includes("application/json")) return false
  const origin = req.headers.get("origin")
  if (!origin) return true
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host")
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export async function readJson<T>(req: NextRequest, maxBytes = 2 * 1024 * 1024): Promise<T | null> {
  const text = await req.text()
  if (text.length > maxBytes) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
