"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Loads JSON from url now and every intervalMs. Skipped while the tab is hidden,
 * and caught up as soon as it is shown again. Errors carry the server's message.
 * An answer `accept` turns down (made for settings the server hasn't saved yet)
 * is asked for again shortly.
 */
export function usePolling<T>(url: string | null, intervalMs: number, accept?: (data: T) => boolean) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const acceptRef = useRef(accept)
  acceptRef.current = accept
  useEffect(() => {
    // Another address is other data: don't keep showing the old one meanwhile.
    setData(null)
    setError(null)
    if (!url) return
    let cancelled = false
    let last = 0
    let retries = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      if (document.hidden) return
      last = Date.now()
      try {
        const res = await fetch(url, { cache: "no-store" })
        const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null
        if (cancelled) return
        if (!res.ok || !json) throw new Error(json?.error ?? `The server answered HTTP ${res.status}.`)
        if (acceptRef.current && !acceptRef.current(json) && retries < 8) {
          retries += 1
          clearTimeout(retry)
          retry = setTimeout(load, 1500)
          return
        }
        retries = 0
        setData(json)
        setError(null)
      } catch (e) {
        if (!cancelled) setError(e instanceof TypeError ? "Can't reach the Tidedeck server." : (e as Error).message)
      }
    }
    const onVisible = () => {
      if (!document.hidden && Date.now() - last >= intervalMs) void load()
    }
    void load()
    const t = setInterval(load, intervalMs)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      clearInterval(t)
      clearTimeout(retry)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [url, intervalMs])
  return { data, error }
}
