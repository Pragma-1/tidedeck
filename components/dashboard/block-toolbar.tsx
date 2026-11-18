"use client"

import { Copy, GripVertical, Settings2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { SendBlockMenu } from "@/components/dashboard/send-to-board"
import { getDashboard, useDashboard } from "@/hooks/use-dashboard"
import { duplicateBlock, removeBlock, setBlockZoom } from "@/lib/board-ops"
import type { Block } from "@/lib/schema"

/** The toolbar on a block in edit mode (loaded with the editor, not with the page). */
export function BlockToolbar({ block, boardId, label, typeLabel, zoom }: { block: Block; boardId: string; label: string; typeLabel: string; zoom: number }) {
  const openSettings = useDashboard((s) => s.openBlockSettings)
  const updateBoard = useDashboard((s) => s.updateBoard)
  const updateBlock = useDashboard((s) => s.updateBlock)
  const bp = useDashboard((s) => s.breakpoint)

  const remove = () => {
    const before = getDashboard().config
    updateBoard(boardId, (b) => removeBlock(b, block.id))
    toast(`Removed “${label}”`, { action: { label: "Undo", onClick: () => getDashboard().replaceConfig(before) } })
  }

  return (
          <div className="absolute top-2 right-7 z-20 flex items-center gap-0.5 rounded-lg border bg-popover/95 p-0.5 shadow-lg">
            {/* Grip: the drag handle on touch screens (elsewhere the whole block drags). */}
            <span className="drag-grip flex h-8 cursor-grab touch-none items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground active:cursor-grabbing">
              <GripVertical className="size-4" aria-hidden />
              <span className="hidden sm:inline">{typeLabel}</span>
            </span>
            {zoom !== 1 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="no-drag h-8 px-1.5 text-xs tabular-nums text-primary"
                    aria-label={`Content zoom ${Math.round(zoom * 100)}%, reset to 100%`}
                    onClick={() => updateBlock(block.id, (b) => setBlockZoom(b, bp, 1))}
                  >
                    {Math.round(zoom * 100)}%
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset zoom to 100%</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" className="no-drag" aria-label={`Settings for ${label}`} onClick={() => openSettings(block.id)}>
                  <Settings2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="no-drag"
                  aria-label={`Duplicate ${label}`}
                  onClick={() => updateBoard(boardId, (b) => void duplicateBlock(b, block.id))}
                >
                  <Copy />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Duplicate</TooltipContent>
            </Tooltip>
            <SendBlockMenu block={block} boardId={boardId} label={label} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="no-drag hover:text-destructive"
                  aria-label={`Remove ${label}`}
                  onClick={remove}
                >
                  <Trash2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove</TooltipContent>
            </Tooltip>
          </div>
  )
}
