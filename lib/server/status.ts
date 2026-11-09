import { Agent, fetch as ufetch } from "undici"
import type { App } from "@/lib/schema"

export type StatusResult = { ok: boolean; code?: number; ms?: number; error?: string; checkedAt: number }

const strict = new Agent({ connect: { timeout: 5000 } })
const lenient = new Agent({ connect: { timeout: 5000, rejectUnauthorized: false } })

const g = globalThis as unknown as { __tidedeckStatus?: Map<string, { key: string; at: number; result: Promise<StatusResult> }> }
const cache = (g.__tidedeckStatus ??= new Map())
const CACHE_MS = 10_000

async function probe(url: string, insecure: boolean): Promise<StatusResult> {
  const started = performance.now()
  const dispatcher = insecure ? lenient : strict
  const attempt = async (method: "HEAD" | "GET") => {
    const res = await ufetch(url, {
      method,
      redirect: "manual",
      dispatcher,
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": "Tidedeck status check" },
    })
    await res.body?.cancel().catch(() => {})
    return res.status
  }
  try {
    let code = await attempt("HEAD")
    if (code === 405 || code === 501) code = await attempt("GET")
    // Anything below 500 means the service answered (401/403 login walls count as up).
    return { ok: code < 500, code, ms: Math.round(performance.now() - started), checkedAt: Date.now() }
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } }
    const reason = e.name === "TimeoutError" ? "Timed out" : e.cause?.code || e.cause?.message || e.message
    return { ok: false, error: reason, checkedAt: Date.now() }
  }
}

export function checkApp(app: App): Promise<StatusResult> {
  const url = (app.statusUrl || app.url).trim()
  if (!/^https?:\/\//i.test(url)) {
    return Promise.resolve({ ok: false, error: "Only http(s) links can be checked", checkedAt: Date.now() })
  }
  const key = `${url}|${app.insecureTls}`
  const hit = cache.get(app.id)
  if (hit && hit.key === key && Date.now() - hit.at < CACHE_MS) return hit.result
  const result = probe(url, app.insecureTls)
  cache.set(app.id, { key, at: Date.now(), result })
  return result
}
