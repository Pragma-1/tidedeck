"use client"

import { useEffect } from "react"
import { flushSave, getDashboard } from "@/hooks/use-dashboard"

/** Keeps every open tab in step with the server and flushes pending saves. */
export function useLiveSync() {
  useEffect(() => {
    let es: EventSource | null = null
    let closed = false

    const pull = async (rev: number) => {
      const state = getDashboard()
      if (rev <= state.rev || state.saveState !== "idle") return
      const res = await fetch("/api/config", { cache: "no-store" })
      if (!res.ok) return
      const body = await res.json()
      if (getDashboard().saveState === "idle") getDashboard().applyRemote(body.config, body.rev)
    }

    const connect = () => {
      if (closed) return
      es = new EventSource("/api/events")
      es.onmessage = (e) => {
        try {
          void pull(JSON.parse(e.data).rev)
        } catch {}
      }
    }
    connect()

    const retry = setInterval(() => {
      if (getDashboard().saveState === "error") void flushSave()
    }, 10_000)
    const onHide = () => void flushSave(true)
    window.addEventListener("pagehide", onHide)

    return () => {
      closed = true
      es?.close()
      clearInterval(retry)
      window.removeEventListener("pagehide", onHide)
    }
  }, [])
}

/** "/" focuses search, "e" toggles edit mode, Esc leaves it. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (document.querySelector("[role=dialog],[role=menu]")) return
      const { editing, requestEdit } = getDashboard()
      if (e.key === "/") {
        const input = document.querySelector<HTMLInputElement>("[data-search-input]")
        if (input) {
          e.preventDefault()
          input.focus()
        }
      } else if (e.key === "e") {
        e.preventDefault()
        requestEdit(!editing)
      } else if (e.key === "Escape" && editing) {
        requestEdit(false)
      }
    }
    // Capture phase: runs before Radix closes a dialog on Escape, so Escape in a dialog never also leaves edit mode.
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])
}
