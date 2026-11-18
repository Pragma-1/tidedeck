"use client"

import { useEffect, useState, type ComponentType } from "react"
import { StaticBoard } from "@/components/dashboard/static-board"
import { getDashboard, useDashboard } from "@/hooks/use-dashboard"
import { loadArrangeApps } from "@/components/widgets/app-widgets"
import { loadPart } from "@/lib/stale-build"
import { toast } from "sonner"
import type { Board } from "@/lib/schema"

type EditGridType = ComponentType<{ board: Board }>
let loaded: EditGridType | null = null
let loading: Promise<EditGridType> | null = null

const fetchEditGrid = loadPart(() => Promise.all([import("@/components/dashboard/edit-grid"), loadArrangeApps()]), { resumeEdit: true })

/** Loads the editor's grid (the drag-and-drop layout library) once, on demand. */
export function loadEditGrid(): Promise<EditGridType> {
  loading ??= fetchEditGrid().then(
    ([m]) => (loaded = m.EditGrid),
    (err: unknown) => {
      // Not cached: the next attempt tries again.
      loading = null
      throw err
    },
  )
  return loading
}

/**
 * The board. Shown, it is plain server-rendered CSS (StaticBoard), so it is on
 * screen as soon as the page is; the editor's grid with dragging and resizing
 * (EditGrid) is loaded only for edit mode, and kept loaded after that. Both
 * place every block exactly alike, so switching between them moves nothing.
 */
export function DeckGrid({ board }: { board: Board }) {
  const editing = useDashboard((s) => s.editing)
  const signedIn = useDashboard((s) => s.auth.authenticated)
  const [EditGrid, setEditGrid] = useState<EditGridType | null>(() => loaded)

  // Whoever may edit gets the editor fetched in the background once the page is idle,
  // so edit mode opens at once; visitors never download it.
  useEffect(() => {
    if (EditGrid || (!editing && !signedIn)) return
    let alive = true
    const go = () =>
      void loadEditGrid().then(
        (C) => alive && setEditGrid(() => C),
        (err: unknown) => {
          if (!alive) return
          console.error("Tidedeck: the editor couldn't be loaded", err)
          // Only when it was asked for; a failed background fetch just waits for the next try.
          if (getDashboard().editing) {
            getDashboard().requestEdit(false)
            toast.error("The editor couldn't be loaded. Check the connection and try again.")
          }
        },
      )
    if (editing) go()
    else if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(go, { timeout: 4000 })
      return () => {
        alive = false
        cancelIdleCallback(id)
      }
    } else {
      const t = setTimeout(go, 1500)
      return () => {
        alive = false
        clearTimeout(t)
      }
    }
    return () => {
      alive = false
    }
  }, [editing, signedIn, EditGrid])

  return editing && EditGrid ? <EditGrid board={board} /> : <StaticBoard board={board} />
}
