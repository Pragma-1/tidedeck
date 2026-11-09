"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createStore, useStore, type StoreApi } from "zustand"
import { toast } from "sonner"
import { configSchema, type Block, type Board, type DashboardConfig } from "@/lib/schema"

export type AuthInfo = { configured: boolean; authenticated: boolean; disabled: boolean }
export type SaveState = "idle" | "pending" | "saving" | "error"

export type DashboardState = {
  config: DashboardConfig
  rev: number
  auth: AuthInfo
  editing: boolean
  activeBoardId: string
  saveState: SaveState
  saveError: string | null
  authDialog: null | "login" | "setup"
  editingBlockId: string | null
  settingsOpen: boolean
}

type Actions = {
  setActiveBoard: (id: string) => void
  requestEdit: (on: boolean) => void
  setAuth: (auth: AuthInfo) => void
  setAuthDialog: (d: DashboardState["authDialog"]) => void
  openBlockSettings: (id: string | null) => void
  setSettingsOpen: (open: boolean) => void
  /** Apply a change locally; it is saved to the server a moment later. */
  mutate: (fn: (draft: DashboardConfig) => void) => void
  updateBoard: (boardId: string, fn: (board: Board) => void) => void
  updateBlock: (blockId: string, fn: (block: Block) => void) => void
  replaceConfig: (config: DashboardConfig) => void
  applyRemote: (config: DashboardConfig, rev: number) => void
}

export type DashboardStore = DashboardState & Actions
type Init = Pick<DashboardState, "config" | "rev" | "auth" | "activeBoardId">

function createDashboardStore(init: Init) {
  return createStore<DashboardStore>()((set, get) => ({
    ...init,
    editing: false,
    saveState: "idle",
    saveError: null,
    authDialog: null,
    editingBlockId: null,
    settingsOpen: false,

    setActiveBoard: (id) => {
      set({ activeBoardId: id })
      const url = new URL(window.location.href)
      url.searchParams.set("board", id)
      window.history.replaceState(null, "", url)
    },

    requestEdit: (on) => {
      if (!on) {
        void flushSave()
        set({ editing: false, editingBlockId: null })
        return
      }
      const { auth } = get()
      if (auth.authenticated) set({ editing: true })
      else set({ authDialog: auth.configured ? "login" : "setup" })
    },

    setAuth: (auth) => set(auth.authenticated ? { auth } : { auth, editing: false }),
    setAuthDialog: (authDialog) => set({ authDialog }),
    openBlockSettings: (editingBlockId) => set({ editingBlockId }),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

    mutate: (fn) => {
      const draft = structuredClone(get().config)
      fn(draft)
      set({ config: draft, saveState: "pending" })
      scheduleSave()
    },

    updateBoard: (boardId, fn) =>
      get().mutate((cfg) => {
        const board = cfg.boards.find((b) => b.id === boardId)
        if (board) fn(board)
      }),

    updateBlock: (blockId, fn) =>
      get().mutate((cfg) => {
        for (const board of cfg.boards) {
          const block = board.blocks.find((b) => b.id === blockId)
          if (block) return fn(block)
        }
      }),

    replaceConfig: (config) => {
      const { activeBoardId } = get()
      set({
        config,
        saveState: "pending",
        activeBoardId: config.boards.some((b) => b.id === activeBoardId) ? activeBoardId : config.boards[0].id,
      })
      scheduleSave()
    },

    applyRemote: (config, rev) => {
      const { activeBoardId } = get()
      set({
        config,
        rev,
        activeBoardId: config.boards.some((b) => b.id === activeBoardId) ? activeBoardId : config.boards[0].id,
      })
    },
  }))
}

// ---------------------------------------------------------------------------
// One store per page render (never shared between server requests).

const Ctx = createContext<StoreApi<DashboardStore> | null>(null)
let clientStore: StoreApi<DashboardStore> | null = null

export function DashboardProvider({ init, children }: { init: Init; children: ReactNode }) {
  const [store] = useState(() => createDashboardStore(init))
  if (typeof window !== "undefined") clientStore = store
  useEffect(() => {
    clientStore = store
  }, [store])
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useDashboard<T>(selector: (s: DashboardStore) => T): T {
  const store = useContext(Ctx)
  if (!store) throw new Error("useDashboard must be used inside <DashboardProvider>")
  return useStore(store, selector)
}

export const getDashboard = () => clientStore!.getState()
const setDashboard = (patch: Partial<DashboardState>) => clientStore!.setState(patch)

export const useActiveBoard = () =>
  useDashboard((s) => s.config.boards.find((b) => b.id === s.activeBoardId) ?? s.config.boards[0])

// ---------------------------------------------------------------------------
// Autosave

let timer: ReturnType<typeof setTimeout> | null = null
let inflight: Promise<void> | null = null
let dirtyWhileSaving = false

function scheduleSave() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void flushSave(), 450)
}

export async function flushSave(keepalive = false): Promise<void> {
  if (!clientStore) return
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const { saveState } = getDashboard()
  if (saveState !== "pending" && saveState !== "error") return
  if (inflight) {
    dirtyWhileSaving = true
    return inflight
  }

  const { config, rev } = getDashboard()
  const check = configSchema.safeParse(config)
  if (!check.success) {
    const issue = check.error.issues[0]
    setDashboard({ saveState: "error", saveError: `${issue.message} (${issue.path.join(" › ")})` })
    return
  }

  inflight = (async () => {
    setDashboard({ saveState: "saving", saveError: null })
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseRev: rev, config }),
        keepalive,
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        setDashboard({ rev: body.rev, saveState: dirtyWhileSaving ? "pending" : "idle" })
      } else if (res.status === 409) {
        dirtyWhileSaving = false
        getDashboard().applyRemote(body.config, body.rev)
        setDashboard({ saveState: "idle" })
        toast("Someone else changed the dashboard", {
          description: "You're now seeing their version. Make your last change again if it's missing.",
        })
      } else if (res.status === 401) {
        setDashboard({ saveState: "error", saveError: "Signed out" })
        getDashboard().setAuth({ ...getDashboard().auth, authenticated: false })
        toast.error("You've been signed out", { description: "Sign in again to keep editing. Your changes are still in this tab." })
      } else {
        const detail = Array.isArray(body.issues) ? body.issues.join("; ") : body.error
        setDashboard({ saveState: "error", saveError: detail ?? `Server answered ${res.status}` })
      }
    } catch {
      setDashboard({ saveState: "error", saveError: "Server not reachable. Retrying…" })
    } finally {
      inflight = null
      if (dirtyWhileSaving) {
        dirtyWhileSaving = false
        scheduleSave()
      }
    }
  })()
  return inflight
}
