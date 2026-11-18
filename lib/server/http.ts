import { NextResponse, type NextRequest } from "next/server"

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "cache-control": "no-store" } })

/** Reads a fetch() response body (global or undici), giving up once it passes maxBytes. */
export async function readLimited(res: { body: AsyncIterable<Uint8Array> | null }, maxBytes: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let size = 0
  // Leaving the loop early cancels the stream.
  for await (const chunk of res.body) {
    size += chunk.byteLength
    if (size > maxBytes) throw new Error(`Response is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  json({ error, ...extra }, status)

/**
 * Origin header (if any) must name the host the request came in on, and
 * browsers that send Fetch Metadata must say the request came from this site.
 */
export function isSameOrigin(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site")
  if (site && site !== "same-origin" && site !== "none") return false
  const origin = req.headers.get("origin")
  if (!origin) return true
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host")
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * CSRF guard for state-changing requests: the browser must send JSON
 * (forces a CORS preflight cross-origin) and a matching Origin.
 */
export function isTrustedMutation(req: NextRequest): boolean {
  if (!req.headers.get("content-type")?.includes("application/json")) return false
  return isSameOrigin(req)
}

/**
 * Reads at most maxBytes of the body and stops as soon as the limit is
 * passed, so an oversized upload can't fill memory (works without a
 * Content-Length header too). Returns null when too big.
 */
export async function readBody(req: NextRequest, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(req.headers.get("content-length") ?? 0)
  if (declared > maxBytes) return null
  if (!req.body) return Buffer.alloc(0)
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export async function readJson<T>(req: NextRequest, maxBytes = 2 * 1024 * 1024): Promise<T | null> {
  const buf = await readBody(req, maxBytes)
  if (!buf) return null
  try {
    return JSON.parse(buf.toString("utf8")) as T
  } catch {
    return null
  }
}
