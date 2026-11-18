"use client"

import dynamic from "next/dynamic"
import { AppWidget, AppsWidget } from "@/components/widgets/app-widgets"
import { IframeWidget, RssWidget, SystemWidget } from "@/components/widgets/data-widgets"
import { ChecklistWidget } from "@/components/widgets/checklist-widget"
import { SearchWidget } from "@/components/widgets/search-widget"
import { CalendarWidget, ClockWidget } from "@/components/widgets/time-widgets"
import { WeatherWidget } from "@/components/widgets/weather-widget"
import { useDashboard } from "@/hooks/use-dashboard"
import { BlockZoomContext } from "@/hooks/use-block-zoom"
import { infoFor } from "@/lib/block-info"
import type { Block } from "@/lib/schema"
import { cn } from "@/lib/utils"
import { loadPart } from "@/lib/stale-build"

// Loaded only where needed: the player and the Markdown renderer only on boards
// that have them, the edit toolbar only in edit mode.
const MusicWidget = dynamic(loadPart(() => import("@/components/widgets/music-widget").then((m) => m.MusicWidget)))
const NotesWidget = dynamic(loadPart(() => import("@/components/widgets/notes-widget").then((m) => m.NotesWidget)))
const BlockToolbar = dynamic(loadPart(() => import("@/components/dashboard/block-toolbar").then((m) => m.BlockToolbar), { resumeEdit: true }), {
  ssr: false,
})

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
    case "checklist":
      return <ChecklistWidget block={block} editing={editing} />
    case "iframe":
      return <IframeWidget block={block} editing={editing} />
    case "music":
      return <MusicWidget block={block} editing={editing} />
  }
}

export function BlockFrame({ block, boardId }: { block: Block; boardId: string }) {
  const editing = useDashboard((s) => s.editing)
  const openSettings = useDashboard((s) => s.openBlockSettings)
  const bp = useDashboard((s) => s.breakpoint)
  // Shown zoom comes from CSS (--bz, set per screen size by the board); this is the same value, for scripts.
  const zoom = block.zoom[bp] ?? 1
  const info = infoFor(block.type)
  const titled = block.showTitle && block.title.trim() !== ""
  const arrange = editing && block.type === "apps" && block.props.apps.length > 1
  const label = block.title || (block.type === "app" ? block.props.app.name : info.label)

  return (
    <section
      aria-label={label}
      className={cn("block-surface tide-corners relative flex h-full flex-col overflow-hidden", editing && "select-none")}
      // On the section, so a double-click on re-orderable tiles opens the settings too.
      onDoubleClick={editing ? (e) => !(e.target as HTMLElement).closest(".no-drag") && openSettings(block.id) : undefined}
    >
      {/* Content zoom (title and body; the edit controls keep their size). */}
      <div className="flex min-h-0 flex-1 flex-col" style={{ zoom: "var(--bz, 1)" }}>
        {titled && (
          <h2 className="truncate px-4 pt-3 pb-2 text-[0.95rem] font-[650] tracking-[-0.01em]">{block.title}</h2>
        )}
        {/* App groups stay interactive while editing so their tiles can be re-ordered; gaps between tiles fall through to the block's drag layer. */}
        <div
          className={cn("@container relative min-h-0 flex-1", arrange && "pointer-events-none z-10")}
          inert={(editing && !arrange) || undefined}
        >
          <BlockZoomContext.Provider value={zoom}>
            <WidgetBody block={block} editing={editing} />
          </BlockZoomContext.Provider>
        </div>
      </div>

      {editing && (
        <div
          className="edit-outline tide-corners absolute inset-0 cursor-grab bg-primary/[0.04] active:cursor-grabbing"
        >
          <BlockToolbar block={block} boardId={boardId} label={label} typeLabel={info.label} zoom={zoom} />
        </div>
      )}
    </section>
  )
}
