"use client"

import type { ReactNode } from "react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useActiveBoard, useDashboard } from "@/hooks/use-dashboard"
import { addBlock } from "@/lib/board-ops"
import { ADD_MENU } from "@/lib/widget-meta"

const GROUPS = [
  ["app", "apps", "bookmarks"],
  ["search", "clock", "calendar", "weather", "system", "rss", "notes", "iframe"],
  ["music"],
]

export function AddBlockMenu({ children }: { children: ReactNode }) {
  const board = useActiveBoard()
  const updateBoard = useDashboard((s) => s.updateBoard)
  const openSettings = useDashboard((s) => s.openBlockSettings)

  const add = (key: string) => {
    const entry = ADD_MENU.find((e) => e.key === key)
    if (!entry) return
    const block = entry.meta.create()
    updateBoard(board.id, (b) => addBlock(b, block))
    // Blocks that need input before they show anything open their settings straight away.
    if (["app", "apps", "bookmarks", "rss", "iframe", "music"].includes(key)) openSettings(block.id)
    requestAnimationFrame(() =>
      document.querySelector(`[data-block-id="${block.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        {GROUPS.map((group, gi) => (
          <div key={gi}>
            {gi > 0 && <DropdownMenuSeparator />}
            {group.map((key) => {
              const { meta } = ADD_MENU.find((e) => e.key === key)!
              return (
                <DropdownMenuItem key={key} onSelect={() => add(key)} className="items-start py-2">
                  <meta.icon className="mt-0.5 size-4 text-primary" />
                  <span className="grid gap-0.5">
                    <span className="font-medium">{meta.label}</span>
                    <span className="text-xs text-muted-foreground">{meta.description}</span>
                  </span>
                </DropdownMenuItem>
              )
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
