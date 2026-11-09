"use client"

import { Copy, GripVertical, Settings2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AppWidget, AppsWidget } from "@/components/widgets/app-widgets"
import { IframeWidget, NotesWidget, RssWidget, SystemWidget } from "@/components/widgets/data-widgets"
import { MusicWidget } from "@/components/widgets/music-widget"
import { SearchWidget } from "@/components/widgets/search-widget"
import { CalendarWidget, ClockWidget } from "@/components/widgets/time-widgets"
import { WeatherWidget } from "@/components/widgets/weather-widget"
import { getDashboard, useDashboard } from "@/hooks/use-dashboard"
import { duplicateBlock, removeBlock } from "@/lib/board-ops"
import type { Block } from "@/lib/schema"
import { cn } from "@/lib/utils"
import { metaFor } from "@/lib/widget-meta"

function WidgetBody({ block, editing }: { block: Block; editing: boolean }) {
  switch (block.type) {
    case "app":
      return <AppWidget block={block} />
    case "apps":
      return <AppsWidget block={block} editing={editing} />
    case "search":
      return <SearchWidget block={block} />
    case "clock":
      return <ClockWidget block={block} />
    case "calendar":
      return <CalendarWidget block={block} />
    case "weather":
      return <WeatherWidget block={block} />
    case "system":
      return <SystemWidget block={block} />
    case "rss":
      return <RssWidget block={block} editing={editing} />
    case "notes":
      return <NotesWidget block={block} editing={editing} />
    case "iframe":
      return <IframeWidget block={block} editing={editing} />
    case "music":
      return <MusicWidget block={block} editing={editing} />
  }
}

export function BlockFrame({ block, boardId }: { block: Block; boardId: string }) {
  const editing = useDashboard((s) => s.editing)
  const openSettings = useDashboard((s) => s.openBlockSettings)
  const updateBoard = useDashboard((s) => s.updateBoard)
  const meta = metaFor(block.type)
  const titled = block.showTitle && block.title.trim() !== ""
  const arrange = editing && block.type === "apps" && block.props.apps.length > 1
  const label = block.title || (block.type === "app" ? block.props.app.name : meta.label)

  const remove = () => {
    const before = getDashboard().config
    updateBoard(boardId, (b) => removeBlock(b, block.id))
    toast(`Removed “${label}”`, { action: { label: "Undo", onClick: () => getDashboard().replaceConfig(before) } })
  }

  return (
    <section
      aria-label={label}
      className={cn("block-surface relative flex h-full flex-col overflow-hidden rounded-xl", editing && "select-none")}
    >
      {titled && (
        <h2 className="truncate px-4 pt-3 pb-2 font-display text-[0.95rem] font-semibold tracking-tight">{block.title}</h2>
      )}
      {/* App groups stay interactive while editing so their tiles can be re-ordered; gaps between tiles fall through to the block's drag layer. */}
      <div
        className={cn("@container relative min-h-0 flex-1", arrange && "pointer-events-none z-10")}
        inert={(editing && !arrange) || undefined}
      >
        <WidgetBody block={block} editing={editing} />
      </div>

      {editing && (
        <div
          className="corner-marks absolute inset-0 cursor-grab rounded-xl bg-primary/[0.04] active:cursor-grabbing"
          onDoubleClick={() => openSettings(block.id)}
        >
          <div className="absolute top-2 right-7 z-20 flex items-center gap-0.5 rounded-lg border bg-popover/95 p-0.5 pl-2 shadow-lg">
            <span className="flex items-center gap-1 pr-1 text-xs text-muted-foreground">
              <GripVertical className="size-3.5" aria-hidden />
              {meta.label}
            </span>
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
        </div>
      )}
    </section>
  )
}
