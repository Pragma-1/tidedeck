"use client"

import { useState } from "react"
import { useTheme } from "next-themes"
import { ArrowLeft, ArrowRight, Check, ChevronDown, CloudOff, Loader2, Moon, Pencil, Plus, Settings, Sun, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AddBlockMenu } from "@/components/dashboard/add-block-menu"
import { MiniPlayer } from "@/components/widgets/music-widget"
import { useDashboard } from "@/hooks/use-dashboard"
import { cn, uid } from "@/lib/utils"

function SaveIndicator() {
  const state = useDashboard((s) => s.saveState)
  const error = useDashboard((s) => s.saveError)
  if (state === "error") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1.5 text-xs text-destructive" role="status">
            <CloudOff className="size-3.5" /> Not saved
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">{error ?? "Unknown error"}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
      {state === "idle" ? <Check className="size-3.5" /> : <Loader2 className="size-3.5 animate-spin" />}
      {state === "idle" ? "Saved" : "Saving"}
    </span>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme !== "light"
  return (
    <Button variant="ghost" size="icon" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setTheme(dark ? "light" : "dark")}>
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  )
}

type NameDialogState = { mode: "add" } | { mode: "rename"; id: string; name: string } | null

export function Header() {
  const title = useDashboard((s) => s.config.settings.title)
  const boards = useDashboard((s) => s.config.boards)
  const activeId = useDashboard((s) => s.activeBoardId)
  const editing = useDashboard((s) => s.editing)
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

  const deleting = boards.find((b) => b.id === confirmDelete)
  const visibleBlockIds = (boards.find((b) => b.id === activeId) ?? boards[0]).blocks.map((b) => b.id)

  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-5">
      <div className="flex min-w-0 flex-wrap items-end gap-x-7 gap-y-2">
        <h1 className="font-display text-[1.75rem] leading-none font-bold tracking-tight">{title}</h1>

        {(boards.length > 1 || editing) && (
          <nav aria-label="Boards" className="-mb-1 flex flex-wrap items-center gap-1">
            {boards.map((b, i) => {
              const active = b.id === activeId
              return (
                <div key={b.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setActive(b.id)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative rounded-md px-2.5 py-1.5 text-sm transition-colors hover:text-foreground",
                      active ? "font-medium text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {b.name}
                    <span
                      aria-hidden
                      className={cn("absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-primary transition-opacity", active ? "opacity-100" : "opacity-0")}
                    />
                  </button>
                  {editing && active && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" className="size-6" aria-label={`Options for ${b.name}`}>
                          <ChevronDown className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem onSelect={() => setNameDialog({ mode: "rename", id: b.id, name: b.name })}>
                          <Pencil /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={i === 0} onSelect={() => moveBoard(b.id, -1)}>
                          <ArrowLeft /> Move left
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={i === boards.length - 1} onSelect={() => moveBoard(b.id, 1)}>
                          <ArrowRight /> Move right
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" disabled={boards.length === 1} onSelect={() => setConfirmDelete(b.id)}>
                          <Trash2 className="text-destructive" /> Delete board
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )
            })}
            {editing && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setNameDialog({ mode: "add" })}>
                <Plus /> Board
              </Button>
            )}
          </nav>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <MiniPlayer visibleBlockIds={visibleBlockIds} />
        {editing && (
          <>
            <SaveIndicator />
            <span className="mx-1.5 h-5 w-px bg-border" aria-hidden />
            <AddBlockMenu>
              <Button variant="secondary">
                <Plus /> Add block
              </Button>
            </AddBlockMenu>
            <Button variant="ghost" size="icon" aria-label="Dashboard settings" onClick={() => setSettingsOpen(true)}>
              <Settings />
            </Button>
          </>
        )}
        <ThemeToggle />
        <Button variant={editing ? "default" : "outline"} onClick={() => requestEdit(!editing)} aria-keyshortcuts="e">
          {editing ? (
            <>
              <Check /> Done
            </>
          ) : (
            <>
              <Pencil /> Edit
            </>
          )}
        </Button>
      </div>

      <NameDialog
        state={nameDialog}
        onClose={() => setNameDialog(null)}
        onSubmit={(name) => {
          if (nameDialog?.mode === "rename") {
            const id = nameDialog.id
            mutate((cfg) => {
              const b = cfg.boards.find((x) => x.id === id)
              if (b) b.name = name
            })
          } else {
            const id = uid()
            mutate((cfg) => void cfg.boards.push({ id, name, blocks: [], layouts: {} }))
            setActive(id)
          }
          setNameDialog(null)
        }}
      />

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              {deleting?.blocks.length
                ? `Its ${deleting.blocks.length} block${deleting.blocks.length === 1 ? "" : "s"} will be deleted too. A backup from the last few minutes stays in the data folder.`
                : "The board is empty."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Keep board
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const id = confirmDelete
                mutate((cfg) => void (cfg.boards = cfg.boards.filter((b) => b.id !== id)))
                const rest = boards.filter((b) => b.id !== id)
                setActive(rest[0].id)
                setConfirmDelete(null)
              }}
            >
              Delete board
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  )
}

function NameDialog({ state, onClose, onSubmit }: { state: NameDialogState; onClose: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState("")
  return (
    <Dialog
      open={!!state}
      onOpenChange={(o) => {
        if (o) return
        onClose()
      }}
    >
      <DialogContent className="sm:max-w-sm" onOpenAutoFocus={() => setName(state?.mode === "rename" ? state.name : "")}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) onSubmit(name.trim().slice(0, 60))
          }}
        >
          <DialogHeader>
            <DialogTitle>{state?.mode === "rename" ? "Rename board" : "New board"}</DialogTitle>
            <DialogDescription>Boards show up as tabs next to the title.</DialogDescription>
          </DialogHeader>
          <Input aria-label="Board name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Media" maxLength={60} />
          <DialogFooter>
            <Button type="submit" disabled={!name.trim()}>
              {state?.mode === "rename" ? "Rename" : "Create board"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
