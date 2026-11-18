"use client"

import { useState } from "react"
import { useTheme } from "next-themes"
import {
  Check,
  CloudOff,
  LayoutDashboard,
  Loader2,
  Moon,
  Pencil,
  Plus,
  Search,
  Settings,
  Sun,
} from "lucide-react"
import type { NameDialogState } from "@/components/dashboard/board-edit"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import dynamic from "next/dynamic"
import { usePlayer } from "@/hooks/use-player"
import { loadPart } from "@/lib/stale-build"
import { getDashboard, useDashboard } from "@/hooks/use-dashboard"
import { useIsDark } from "@/hooks/use-is-dark"
import { cn } from "@/lib/utils"

// Edit mode only, and only while music plays: not loaded with the page.
const AddBlockMenu = dynamic(
  loadPart(() => import("@/components/dashboard/add-block-menu").then((m) => m.AddBlockMenu), { resumeEdit: true }),
  { ssr: false },
)
const MiniPlayer = dynamic(loadPart(() => import("@/components/widgets/music-widget").then((m) => m.MiniPlayer)), { ssr: false })

function SaveIndicator() {
  const state = useDashboard((s) => s.saveState)
  const error = useDashboard((s) => s.saveError)
  if (state === "error") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1.5 px-1 text-xs text-[#f08a80]" role="status">
            <CloudOff className="size-3.5" /> Not saved
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">{error ?? "Unknown error"}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <span className="flex items-center gap-1.5 px-1 text-xs text-band-ink/65" role="status" aria-live="polite">
      {state === "idle" ? <Check className="size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}
      {state === "idle" ? "Saved" : "Saving"}
    </span>
  )
}

function ThemeToggle() {
  const { setTheme } = useTheme()
  const dark = useIsDark()
  const label = dark ? "Switch to light theme" : "Switch to dark theme"
  return (
    <button type="button" className="band-btn" aria-label={label} title={label} onClick={() => setTheme(dark ? "light" : "dark")}>
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </button>
  )
}

// Board renaming, moving and deleting are edit-mode only: loaded on first use, not with the page.
const BoardOptions = dynamic(loadPart(() => import("@/components/dashboard/board-edit").then((m) => m.BoardOptions), { resumeEdit: true }), { ssr: false })
const BoardDialogs = dynamic(loadPart(() => import("@/components/dashboard/board-edit").then((m) => m.BoardDialogs), { resumeEdit: true }), { ssr: false })

/** The dark Tidewiki band: brand, boards, actions. The board below overlaps its lower edge. */
export function Header() {
  const title = useDashboard((s) => s.config.settings.title)
  const boards = useDashboard((s) => s.config.boards)
  const activeId = useDashboard((s) => s.activeBoardId)
  const editing = useDashboard((s) => s.editing)
  const quickLaunch = useDashboard((s) => s.config.settings.search.quickLaunch)
  const setActive = useDashboard((s) => s.setActiveBoard)
  const requestEdit = useDashboard((s) => s.requestEdit)
  const mutate = useDashboard((s) => s.mutate)
  const setSettingsOpen = useDashboard((s) => s.setSettingsOpen)
  const [nameDialog, setNameDialog] = useState<NameDialogState>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const moveBoard = (id: string, d: -1 | 1) =>
    mutate((cfg) => {
      const i = cfg.boards.findIndex((b) => b.id === id)
      const j = i + d
      if (i < 0 || j < 0 || j >= cfg.boards.length) return
      ;[cfg.boards[i], cfg.boards[j]] = [cfg.boards[j], cfg.boards[i]]
    })

  const [dialogsUsed, setDialogsUsed] = useState(false)
  const showBoardDialogs = dialogsUsed || nameDialog !== null || confirmDelete !== null
  if (showBoardDialogs && !dialogsUsed) setDialogsUsed(true)
  const playing = usePlayer((s) => s.blockId !== null)
  const visibleBlockIds = (boards.find((b) => b.id === activeId) ?? boards[0]).blocks.map((b) => b.id)

  return (
    <header className="band">
      <div className="page-col px-4 pt-3.5 pb-16 sm:px-6 lg:px-10">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-2.5 pr-2">
            <LayoutDashboard className="size-[22px] shrink-0 opacity-85" aria-hidden />
            <h1 className="truncate text-xl font-[650] tracking-[-0.01em]">{title}</h1>
          </div>

          {(boards.length > 1 || editing) && (
            <nav aria-label="Boards" className="flex flex-wrap items-center gap-0.5">
              {boards.map((b, i) => {
                const active = b.id === activeId
                return (
                  <div key={b.id} className="flex items-center">
                    <button
                      type="button"
                      onClick={() => setActive(b.id)}
                      aria-current={active ? "page" : undefined}
                      className={cn("band-btn relative", active ? "font-semibold text-band-ink" : "text-band-ink/70")}
                    >
                      {b.name}
                      <span
                        aria-hidden
                        className={cn(
                          "absolute inset-x-2.5 bottom-0.5 h-0.5 rounded-full bg-band-accent transition-opacity",
                          active ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </button>
                    {editing && active && (
                      <BoardOptions
                        board={b}
                        index={i}
                        count={boards.length}
                        onRename={() => setNameDialog({ mode: "rename", id: b.id, name: b.name })}
                        onMove={(d) => moveBoard(b.id, d)}
                        onDelete={() => setConfirmDelete(b.id)}
                      />
                    )}
                  </div>
                )
              })}
              {editing && (
                <button type="button" className="band-btn text-band-ink/70" onClick={() => setNameDialog({ mode: "add" })}>
                  <Plus /> Board
                </button>
              )}
            </nav>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-1">
            {playing && <MiniPlayer visibleBlockIds={visibleBlockIds} />}
            {editing && (
              <>
                <SaveIndicator />
                <span className="mx-1 h-5 w-px bg-band-line" aria-hidden />
                <AddBlockMenu>
                  <button type="button" className="band-btn outline">
                    <Plus /> Add block
                  </button>
                </AddBlockMenu>
                <button type="button" className="band-btn" aria-label="Dashboard settings" title="Dashboard settings" onClick={() => setSettingsOpen(true)}>
                  <Settings />
                </button>
              </>
            )}
            {!editing && quickLaunch && (
              <button
                type="button"
                className="band-btn"
                aria-label="Quick launch"
                title="Quick launch (Ctrl+K)"
                aria-keyshortcuts="Control+K Meta+K"
                onClick={() => getDashboard().setQuickLaunch(true)}
              >
                <Search />
              </button>
            )}
            <ThemeToggle />
            <button
              type="button"
              className={cn("band-btn", editing ? "solid" : "outline")}
              onClick={() => requestEdit(!editing)}
              aria-keyshortcuts="e"
            >
              {editing ? (
                <>
                  <Check /> Done
                </>
              ) : (
                <>
                  <Pencil /> Edit
                </>
              )}
            </button>
          </div>
        </div>

        {editing && (
          <p className="mt-2.5 text-xs text-band-ink/60">
            <span className="[@media(pointer:coarse)]:hidden">
              Drag a block to move it, pull any corner or edge to resize it, double-click it for settings. Press Esc when you’re done.
            </span>
            <span className="hidden [@media(pointer:coarse)]:inline">Move a block by its grip, resize it from any corner or edge, tap the gear for settings.</span>
          </p>
        )}
      </div>

      {showBoardDialogs && (
        <BoardDialogs
          nameDialog={nameDialog}
          setNameDialog={setNameDialog}
          confirmDelete={confirmDelete}
          setConfirmDelete={setConfirmDelete}
        />
      )}
    </header>
  )
}
