"use client"

import { useEffect } from "react"
import { flushSave, getDashboard } from "@/hooks/use-dashboard"
import { usePlayer } from "@/hooks/use-player"
import { getPageBuild, reloadForUpdate } from "@/lib/stale-build"

/**
 * A newer Tidedeck runs on the server: reload once nothing would be lost or
 * interrupted (not while editing, saving, typing, with a dialog open or music
 * playing). A hidden tab reloads as soon as that holds.
 */
function quietMoment(): boolean {
  const d = getDashboard()
  if (d.editing || d.saveState !== "idle" || usePlayer.getState().playing) return false
  if (document.visibilityState === "hidden") return true
  const el = document.activeElement as HTMLElement | null
  const typing = !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
  return !typing && !document.querySelector("[role=dialog],[role=menu],[role=alertdialog]")
}

/** Keeps every open tab in step with the server and flushes pending saves. */
export function useLiveSync() {
  useEffect(() => {
    let es: EventSource | null = null
    let closed = false
    let outdated: string | null = null
    const updateIfQuiet = () => {
      if (outdated && quietMoment()) reloadForUpdate({ build: outdated })
    }

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
          const msg = JSON.parse(e.data) as { rev: number; build?: string }
          const mine = getPageBuild()
          if (msg.build && msg.build !== "dev" && mine !== "dev" && msg.build !== mine) {
            outdated = msg.build
            updateIfQuiet()
          }
          void pull(msg.rev)
        } catch {}
      }
    }
    connect()

    const retry = setInterval(() => {
      if (getDashboard().saveState === "error") void flushSave()
      updateIfQuiet()
    }, 10_000)
    const onHide = () => void flushSave(true)
    window.addEventListener("pagehide", onHide)
    document.addEventListener("visibilitychange", updateIfQuiet)

    return () => {
      closed = true
      es?.close()
      clearInterval(retry)
      window.removeEventListener("pagehide", onHide)
      document.removeEventListener("visibilitychange", updateIfQuiet)
    }
  }, [])
}

/**
 * Ctrl/⌘+K: quick launch. "/": the board's search block, else quick launch.
 * "e" (or Shift+E) toggles edit mode, Esc leaves it. With "Start typing
 * anywhere", letters and digits open quick launch and edit mode is Shift+E.
 */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))
      const blocked = document.querySelector("[role=dialog],[role=menu],[role=alertdialog]")
      const { editing, requestEdit, setQuickLaunch, config } = getDashboard()
      const ql = config.settings.search
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k" && ql.quickLaunch && !blocked) {
        e.preventDefault()
        setQuickLaunch(true)
        return
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || blocked) return
      if (e.key === "E" && e.shiftKey) {
        e.preventDefault()
        requestEdit(!editing)
        return
      }
      if (ql.quickLaunch && ql.typeAnywhere && !editing && /^[\p{L}\p{N}!]$/u.test(e.key)) {
        e.preventDefault()
        setQuickLaunch(true, e.key)
        return
      }
      if (e.key === "/") {
        const input = document.querySelector<HTMLInputElement>("[data-search-input]")
        if (input) {
          e.preventDefault()
          input.focus()
        } else if (ql.quickLaunch) {
          e.preventDefault()
          setQuickLaunch(true)
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
