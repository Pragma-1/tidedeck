"use client"

import { useEffect } from "react"
import { create } from "zustand"
import type { App } from "@/lib/schema"

export type StatusResult = { ok: boolean; code?: number; ms?: number; error?: string; checkedAt: number }

export const useStatusStore = create<{ results: Record<string, StatusResult> }>()(() => ({ results: {} }))

export const useAppStatus = (id: string) => useStatusStore((s) => s.results[id])

/** One poller for every visible app; the server probes on our behalf. */
export function useStatusPolling(apps: App[], intervalSec: number) {
  const ids = apps
    .filter((a) => a.statusCheck && (a.statusUrl || /^https?:\/\//i.test(a.url)))
    .map((a) => a.id)
    .sort()
    .join(",")

  useEffect(() => {
    if (!ids) return
    let stopped = false
    const run = async () => {
      if (document.hidden) return
      try {
        const res = await fetch(`/api/status?ids=${encodeURIComponent(ids)}`, { cache: "no-store" })
        if (!res.ok || stopped) return
        const data = (await res.json()) as Record<string, StatusResult>
        useStatusStore.setState((s) => ({ results: { ...s.results, ...data } }))
      } catch {}
    }
    void run()
    const t = setInterval(run, intervalSec * 1000)
    const onVisible = () => !document.hidden && void run()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      stopped = true
      clearInterval(t)
      document.removeEventListener("visibilitychange", onVisible)
    }
    // Re-run when the set of checked apps or their URLs change.
  }, [ids, intervalSec, apps.map((a) => `${a.id}${a.url}${a.statusUrl}${a.insecureTls}`).join("|")])
}
