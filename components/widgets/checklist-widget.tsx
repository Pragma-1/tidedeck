"use client"

import { useMemo, useRef, useState } from "react"
import { Check, Plus, X } from "lucide-react"
import { useDashboard } from "@/hooks/use-dashboard"
import type { BlockOf } from "@/lib/schema"
import { cn, uid } from "@/lib/utils"

/**
 * A to-do list. Signed-in people tick, add and remove items right on the
 * dashboard (no edit mode needed); visitors see it read-only.
 */
export function ChecklistWidget({ block, editing }: { block: BlockOf<"checklist">; editing: boolean }) {
  const { items, doneLast } = block.props
  const canWrite = useDashboard((s) => s.auth.authenticated) && !editing
  const updateBlock = useDashboard((s) => s.updateBlock)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const shown = useMemo(
    () => (doneLast ? [...items.filter((i) => !i.done), ...items.filter((i) => i.done)] : items),
    [items, doneLast],
  )
  const doneCount = items.filter((i) => i.done).length

  const change = (fn: (list: BlockOf<"checklist">["props"]["items"]) => void) =>
    updateBlock(block.id, (b) => {
      if (b.type === "checklist") fn(b.props.items)
    })

  const add = () => {
    const text = draft.trim().slice(0, 300)
    if (!text || items.length >= 300) return
    change((list) => void list.push({ id: uid(), text, done: false }))
    setDraft("")
    inputRef.current?.focus()
  }

  return (
    <div className="flex h-full flex-col px-2 pb-2">
      {items.length === 0 && (
        <p className="px-2 pb-1 text-sm text-muted-foreground">{canWrite ? "Nothing to do. Add the first item below." : "Nothing to do."}</p>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {shown.map((item) => (
          <li key={item.id} className="group/item flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent/50">
            <button
              type="button"
              role="checkbox"
              aria-checked={item.done}
              aria-label={item.text}
              disabled={!canWrite}
              onClick={() => change((list) => void list.forEach((i) => i.id === item.id && (i.done = !i.done)))}
              className={cn(
                "mt-0.5 grid size-[1.1rem] shrink-0 place-items-center rounded-[0.3rem] border-[1.5px] transition-colors",
                item.done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/60",
                canWrite ? "cursor-pointer hover:border-primary" : "cursor-default",
              )}
            >
              {item.done && <Check className="size-3" strokeWidth={3} aria-hidden />}
            </button>
            <span className={cn("min-w-0 flex-1 text-sm leading-snug break-words", item.done && "text-muted-foreground line-through")}>
              {item.text}
            </span>
            {canWrite && (
              <button
                type="button"
                aria-label={`Remove ${item.text}`}
                onClick={() => change((list) => void list.splice(list.findIndex((i) => i.id === item.id), 1))}
                className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/item:opacity-100 hover:text-foreground focus-visible:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <form
          className="mt-1 flex items-center gap-1.5 border-t px-1 pt-2"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={draft}
            maxLength={300}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add an item"
            aria-label="New item"
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {doneCount > 0 && (
            <button
              type="button"
              onClick={() => change((list) => void list.splice(0, list.length, ...list.filter((i) => !i.done)))}
              className="shrink-0 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Clear {doneCount} done
            </button>
          )}
        </form>
      )}
    </div>
  )
}
