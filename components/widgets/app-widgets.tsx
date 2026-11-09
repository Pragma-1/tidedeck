"use client"

import { useEffect, useMemo, useState } from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useDashboard } from "@/hooks/use-dashboard"
import type { App, BlockOf } from "@/lib/schema"
import { cn } from "@/lib/utils"
import { AppIcon, AppLink, StatusDot } from "@/components/widgets/app-tile"

/** Single app: stacks vertically in narrow blocks, goes horizontal when there's room. */
export function AppWidget({ block }: { block: BlockOf<"app"> }) {
  const app = block.props.app
  return (
    <AppLink app={app} className="relative flex h-full items-center rounded-xl transition-colors hover:bg-accent/60">
      <div className="flex w-full flex-col items-center gap-2 p-3 text-center @[15rem]:flex-row @[15rem]:gap-3.5 @[15rem]:px-4 @[15rem]:text-left">
        <AppIcon app={app} className="size-10 text-lg @[15rem]:size-11" />
        <div className="min-w-0">
          <div className="truncate font-medium leading-tight">{app.name || "Untitled"}</div>
          {app.description && (
            <div className="mt-0.5 hidden truncate text-sm text-muted-foreground @[9rem]:block">{app.description}</div>
          )}
        </div>
      </div>
      <StatusDot app={app} className="absolute top-3 right-3" />
    </AppLink>
  )
}

// --- Ordering ---------------------------------------------------------------

type Sort = BlockOf<"apps">["props"]["sort"]

/** Small seeded PRNG, so a random order stays put until the page is reloaded. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true })

export function orderApps(apps: App[], sort: Sort, seed: number | null): App[] {
  if (sort === "az") return [...apps].sort((a, b) => collator.compare(a.name, b.name))
  if (sort === "za") return [...apps].sort((a, b) => collator.compare(b.name, a.name))
  if (sort === "random" && seed !== null) {
    const rand = mulberry32(seed)
    const out = [...apps]
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  return apps
}

// --- App group --------------------------------------------------------------

const GRID = "grid grid-cols-1 gap-1.5 px-2 pb-2 @[20rem]:grid-cols-2 @[34rem]:grid-cols-3 @[50rem]:grid-cols-4"
const LIST = "flex flex-col px-2 pb-2"

function TileBody({ app, display, showDescription, showStatus }: { app: App } & Pick<BlockOf<"apps">["props"], "display" | "showDescription" | "showStatus">) {
  if (display === "list") {
    return (
      <>
        <AppIcon app={app} className="size-5 text-[0.7rem]" />
        <span className="min-w-0 flex-1 truncate text-sm">{app.name}</span>
        {showDescription && app.description && (
          <span className="hidden truncate text-xs text-muted-foreground @[18rem]:inline">{app.description}</span>
        )}
        {showStatus && <StatusDot app={app} />}
      </>
    )
  }
  return (
    <>
      <AppIcon app={app} className="size-8 text-sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-tight">{app.name}</span>
        {showDescription && app.description && <span className="block truncate text-xs text-muted-foreground">{app.description}</span>}
      </span>
      {showStatus && <StatusDot app={app} />}
    </>
  )
}

const rowClass = (display: "grid" | "list") =>
  display === "list"
    ? "flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors"
    : "relative flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors"

export function AppsWidget({ block, editing }: { block: BlockOf<"apps">; editing: boolean }) {
  const { apps, display, showDescription, showStatus, sort } = block.props
  // Random order is decided after mount so server and browser render the same HTML first.
  const [seed, setSeed] = useState<number | null>(null)
  useEffect(() => {
    if (sort === "random") setSeed(Math.floor(Math.random() * 2 ** 31))
  }, [sort])
  const ordered = useMemo(() => orderApps(apps, sort, seed), [apps, sort, seed])

  if (apps.length === 0) {
    return (
      <p className="px-4 pb-4 text-sm text-muted-foreground">
        {editing ? "Open this block's settings to add links." : "No links yet."}
      </p>
    )
  }

  if (editing) return <ArrangeApps block={block} ordered={ordered} />

  return (
    <ul className={display === "list" ? LIST : GRID}>
      {ordered.map((app) => (
        <li key={app.id}>
          <AppLink app={app} className={cn(rowClass(display), "hover:bg-accent/70")}>
            <TileBody app={app} display={display} showDescription={showDescription} showStatus={showStatus} />
          </AppLink>
        </li>
      ))}
    </ul>
  )
}

/**
 * Edit mode: tiles can be dragged into a new order (mouse, touch or keyboard:
 * focus a tile, Space to lift, arrows to move, Space to drop). Gaps between
 * tiles still drag the whole block.
 */
function ArrangeApps({ block, ordered }: { block: BlockOf<"apps">; ordered: App[] }) {
  const updateBlock = useDashboard((s) => s.updateBlock)
  const { display, showDescription, showStatus } = block.props
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const ids = ordered.map((a) => a.id)
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
    updateBlock(block.id, (b) => {
      if (b.type !== "apps") return
      const byId = new Map(b.props.apps.map((a) => [a.id, a]))
      b.props.apps = next.map((id) => byId.get(id)!).filter(Boolean)
      // Dragging means you want this exact order, so A–Z / random give way to it.
      b.props.sort = "custom"
    })
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ordered.map((a) => a.id)} strategy={display === "list" ? verticalListSortingStrategy : rectSortingStrategy}>
        <ul className={display === "list" ? LIST : GRID}>
          {ordered.map((app) => (
            <SortableTile key={app.id} app={app} display={display} showDescription={showDescription} showStatus={showStatus} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

function SortableTile({ app, ...props }: { app: App } & Pick<BlockOf<"apps">["props"], "display" | "showDescription" | "showStatus">) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: app.id })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-label={`${app.name}. Press space to move it.`}
      className={cn(
        "no-drag pointer-events-auto cursor-grab touch-none rounded-lg bg-card/40 outline-none ring-1 ring-primary/25 focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
        isDragging && "relative z-10 bg-popover shadow-xl ring-2 ring-primary",
      )}
    >
      <div className={rowClass(props.display)}>
        <TileBody app={app} {...props} />
      </div>
    </li>
  )
}
