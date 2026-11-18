"use client"

import { useState } from "react"
import { ArrowLeft, ArrowRight, ChevronDown, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useDashboard } from "@/hooks/use-dashboard"
import type { Board } from "@/lib/schema"
import { uid } from "@/lib/utils"

export type NameDialogState = { mode: "add" } | { mode: "rename"; id: string; name: string } | null

/** The menu next to the active board's tab in edit mode. */
export function BoardOptions({
  board,
  index,
  count,
  onRename,
  onMove,
  onDelete,
}: {
  board: Board
  index: number
  count: number
  onRename: () => void
  onMove: (d: -1 | 1) => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="band-btn px-1.5!" aria-label={`Options for ${board.name}`}>
          <ChevronDown className="size-3.5!" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={onRename}>
          <Pencil /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>
          <ArrowLeft /> Move left
        </DropdownMenuItem>
        <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(1)}>
          <ArrowRight /> Move right
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={count === 1} onSelect={onDelete}>
          <Trash2 className="text-destructive" /> Delete board
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Naming a new or renamed board, and confirming a board's deletion. */
export function BoardDialogs({
  nameDialog,
  setNameDialog,
  confirmDelete,
  setConfirmDelete,
}: {
  nameDialog: NameDialogState
  setNameDialog: (s: NameDialogState) => void
  confirmDelete: string | null
  setConfirmDelete: (id: string | null) => void
}) {
  const boards = useDashboard((s) => s.config.boards)
  const mutate = useDashboard((s) => s.mutate)
  const setActive = useDashboard((s) => s.setActiveBoard)
  const deleting = boards.find((b) => b.id === confirmDelete)
  return (
    <>
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
    </>
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
