"use client"

import { ArrowRightLeft, Copy, FolderInput, LayoutGrid, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { getDashboard, useDashboard } from "@/hooks/use-dashboard"
import type { AppTarget, SendMode } from "@/lib/board-ops"
import { loadPart } from "@/lib/stale-build"

// The operations (and the schema they use) load on first use, not with the page.
type Ops = typeof import("@/lib/board-ops")
const loadOps = loadPart(() => import("@/lib/board-ops"))
import type { App, Block, DashboardConfig } from "@/lib/schema"

const MAX_BOARDS = 50
const NEW = "__new__"

/**
 * Runs a copy or move, then says where the thing went, with a way to go there
 * and a way to take it back. `to` NEW makes a fresh board first.
 */
async function send(
  what: string,
  mode: SendMode,
  to: string,
  op: (ops: Ops, cfg: DashboardConfig, boardId: string) => { error: string } | object,
  note?: string,
) {
  let ops: Ops
  try {
    ops = await loadOps()
  } catch (err) {
    console.error("Tidedeck: copy/move couldn't be loaded", err)
    return void toast.error("That didn't work. Check the connection and try again.")
  }
  const { config, mutate } = getDashboard()
  if (to === NEW && config.boards.length >= MAX_BOARDS) return void toast.error(`There can be at most ${MAX_BOARDS} boards.`)
  const before = config
  // Try it on a copy first, so a refusal changes nothing (no new board without the block, say).
  const run = (cfg: DashboardConfig) => {
    const target = to === NEW ? ops.addBoard(cfg, "New board") : to
    const result = op(ops, cfg, target)
    return { target, error: "error" in result ? (result as { error: string }).error : null }
  }
  const probe = run(structuredClone(config))
  if (probe.error) return void toast.error(probe.error)
  let target = to
  mutate((cfg) => void (target = run(cfg).target))
  const name = getDashboard().config.boards.find((b) => b.id === target)?.name ?? "the board"
  toast(`${mode === "copy" ? "Copied" : "Moved"} “${what}” to “${name}”`, {
    description: note,
    action: {
      label: "Show",
      onClick: () => getDashboard().setActiveBoard(target),
    },
    cancel: { label: "Undo", onClick: () => getDashboard().replaceConfig(before) },
  })
}

/** The toolbar button on a block in edit mode: copy or move the block to another board. */
export function SendBlockMenu({ block, boardId, label }: { block: Block; boardId: string; label: string }) {
  const boards = useDashboard((s) => s.config.boards)
  const others = boards.filter((b) => b.id !== boardId)
  // A copy is a new block: the music server sign-in stays with the original (a moved block keeps it).
  const note = (mode: SendMode) =>
    mode === "copy" && block.type === "music" && block.props.source === "navidrome" ? "Sign the copy in to the music server in its settings." : undefined
  const go = (mode: SendMode, to: string) => void send(label, mode, to, (ops, cfg, target) => ops.sendBlock(cfg, boardId, block.id, target, mode), note(mode))
  const list = (mode: SendMode) => (
    <>
      {others.map((b) => (
        <DropdownMenuItem key={b.id} onSelect={() => go(mode, b.id)}>
          <LayoutGrid /> <span className="truncate">{b.name}</span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem disabled={boards.length >= MAX_BOARDS} onSelect={() => go(mode, NEW)}>
        <Plus /> New board
      </DropdownMenuItem>
    </>
  )
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" className="no-drag" aria-label={`Copy or move ${label} to another board`}>
              <FolderInput />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Copy or move to another board</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="max-w-[16rem]" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel className="flex items-center gap-2">
          <Copy className="size-3.5" /> Copy to
        </DropdownMenuLabel>
        {list("copy")}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2">
          <ArrowRightLeft className="size-3.5" /> Move to
        </DropdownMenuLabel>
        {list("move")}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Right-click menu entries for an app (for whoever may edit): copy or move it
 * into an app group on any board, or into a block of its own.
 */
export function SendAppItems({ blockId, app }: { blockId: string; app: App }) {
  const allowed = useDashboard((s) => s.auth.authenticated && !s.kiosk)
  const boards = useDashboard((s) => s.config.boards)
  if (!allowed) return null
  const source = boards.flatMap((b) => b.blocks).find((b) => b.id === blockId)
  if (!source) return null
  const sourceBoard = boards.find((b) => b.blocks.some((x) => x.id === blockId))!
  const what = app.name || app.url || "App"
  const go = (mode: SendMode, target: AppTarget | typeof NEW) =>
    void send(what, mode, target === NEW ? NEW : target.boardId, (ops, cfg, boardId) =>
      ops.sendApp(cfg, blockId, app.id, target === NEW ? { boardId } : { ...target, boardId }, mode),
    )

  const targets = (mode: SendMode) => (
    <>
      {boards.map((b) => {
        const groups = b.blocks.filter((x) => x.type === "apps" && x.id !== blockId)
        // An app block can't be moved onto the board it's already on as a block of its own.
        const ownBlock = !(mode === "move" && source.type === "app" && b.id === sourceBoard.id)
        if (!groups.length && !ownBlock) return null
        if (!groups.length)
          return (
            <ContextMenuItem key={b.id} onSelect={() => go(mode, { boardId: b.id })}>
              <LayoutGrid /> <span className="truncate">{b.name}</span>
            </ContextMenuItem>
          )
        return (
          <ContextMenuSub key={b.id}>
            <ContextMenuSubTrigger>
              <LayoutGrid /> <span className="truncate">{b.name}</span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-w-[18rem]">
              {ownBlock && (
                <>
                  <ContextMenuItem onSelect={() => go(mode, { boardId: b.id })}>
                    <Plus /> As a block of its own
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                </>
              )}
              <ContextMenuLabel>Into an app group</ContextMenuLabel>
              {groups.map((g) => (
                <ContextMenuItem key={g.id} onSelect={() => go(mode, { boardId: b.id, groupId: g.id })}>
                  <span className="truncate">{g.title.trim() || "Untitled group"}</span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )
      })}
      <ContextMenuSeparator />
      <ContextMenuItem disabled={boards.length >= MAX_BOARDS} onSelect={() => go(mode, NEW)}>
        <Plus /> New board
      </ContextMenuItem>
    </>
  )

  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <Copy /> Copy to
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-w-[16rem]">{targets("copy")}</ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <ArrowRightLeft /> Move to
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="max-w-[16rem]">{targets("move")}</ContextMenuSubContent>
      </ContextMenuSub>
    </>
  )
}
