"use client"

import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useBlockZoom } from "@/hooks/use-block-zoom"
import { useDashboard } from "@/hooks/use-dashboard"
import type { App, BlockOf } from "@/lib/schema"
import { cn } from "@/lib/utils"
import { TileBody, listClass, rowClass } from "@/components/widgets/app-widgets"
import { ContextMenu, ContextMenuContent, ContextMenuLabel, ContextMenuTrigger } from "@/components/ui/context-menu"
import { SendAppItems } from "@/components/dashboard/send-to-board"

/**
 * Edit mode: tiles can be dragged into a new order (mouse, touch or keyboard:
 * focus a tile, Space to lift, arrows to move, Space to drop). Gaps between
 * tiles still drag the whole block.
 */
export function ArrangeApps({ block, ordered }: { block: BlockOf<"apps">; ordered: App[] }) {
  const updateBlock = useDashboard((s) => s.updateBlock)
  const { display, showDescription, showStatus } = block.props
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
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
        <ul className={listClass(display)}>
          {ordered.map((app) => (
            <SortableTile key={app.id} app={app} blockId={block.id} display={display} showDescription={showDescription} showStatus={showStatus} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

function SortableTile({
  app,
  blockId,
  ...props
}: { app: App; blockId: string } & Pick<BlockOf<"apps">["props"], "display" | "showDescription" | "showStatus">) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: app.id })
  const zoom = useBlockZoom()
  // Right-click (or long-press): copy or move this app to another board or group.
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          ref={setNodeRef}
          // dnd-kit measures in screen pixels; inside a zoomed block a translate is zoomed too.
          style={{
            transform: CSS.Translate.toString(
              transform && {
                ...transform,
                x: transform.x / zoom,
                y: transform.y / zoom,
              },
            ),
            transition,
          }}
          {...attributes}
          {...listeners}
          aria-label={`${app.name}. Press space to move it.`}
          className={cn(
            "no-drag pointer-events-auto cursor-grab touch-none bg-card/40 outline-none ring-1 ring-primary/25 focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
            props.display === "compact" ? "rounded-full" : "rounded-lg",
            isDragging && "relative z-10 bg-popover shadow-xl ring-2 ring-primary",
          )}
        >
          <div className={rowClass(props.display)}>
            <TileBody app={app} {...props} />
          </div>
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{app.name || app.url || "App"}</ContextMenuLabel>
        <SendAppItems blockId={blockId} app={app} />
      </ContextMenuContent>
    </ContextMenu>
  )
}
