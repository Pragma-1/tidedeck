"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Search } from "lucide-react"
import { useDashboard } from "@/hooks/use-dashboard"
import { useBlockZoom } from "@/hooks/use-block-zoom"
import { collectApps } from "@/lib/model"
import type { App, BlockOf } from "@/lib/schema"
import { cn } from "@/lib/utils"
import { openLink } from "@/hooks/use-overlay"
import { ENGINE_NAMES, asUrl, engineTemplate, fillTemplate, parseShortcut } from "@/lib/search"
import { AppIcon } from "@/components/widgets/app-tile"

export { ENGINE_NAMES } from "@/lib/search"

export function SearchWidget({ block }: { block: BlockOf<"search"> }) {
  const { engine, customUrl, searchApps, newTab } = block.props
  const config = useDashboard((s) => s.config)
  const allApps = useMemo(() => collectApps(config), [config])
  const [q, setQ] = useState("")
  const [active, setActive] = useState(0)
  const listId = useId()
  const anchor = useRef<HTMLLabelElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const zoom = useBlockZoom()
  const [focused, setFocused] = useState(false)

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!searchApps || !term || term.startsWith("!")) return []
    return allApps
      .filter((a) => a.name.toLowerCase().includes(term) || a.description.toLowerCase().includes(term))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(term)) - Number(!b.name.toLowerCase().startsWith(term)))
      .slice(0, 6)
  }, [q, allApps, searchApps])

  // The block clips its content, so the suggestion list lives in a portal positioned under the input.
  const open = focused && matches.length > 0
  useEffect(() => {
    if (!open) return
    const update = () => anchor.current && setRect(anchor.current.getBoundingClientRect())
    update()
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [open])

  const template = engineTemplate(engine, customUrl)
  const engineName = ENGINE_NAMES[engine]
  const shortcuts = config.settings.search.shortcuts
  const bang = parseShortcut(q, shortcuts)

  const go = (url: string | null) => {
    if (url) openLink(url, "", newTab ? "new" : "same")
    setQ("")
  }
  const launch = (app: App, alt = false) => {
    openLink(app.url, app.name, alt ? "overlay" : app.target === "same" ? "same" : app.target === "overlay" ? "overlay" : "new")
    setQ("")
  }

  // Order: an app picked in the list, a search shortcut (!yt …), a typed address, a web search.
  const submit = (alt = false) => {
    const term = q.trim()
    if (!term) return
    const pick = matches[active]
    if (pick) return launch(pick, alt)
    if (bang) return go(fillTemplate(bang.shortcut.url, bang.term))
    const url = asUrl(term)
    if (url) return go(url)
    go(fillTemplate(template, term))
  }

  return (
    <div className="relative flex h-full items-center px-3">
      <form
        role="search"
        className="w-full"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label ref={anchor} className="flex h-12 items-center gap-3 rounded-full border bg-muted px-4 ring-ring/40 transition-shadow focus-within:ring-2">
          <Search className="size-[1.1rem] shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">Search</span>
          <input
            data-search-input
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setActive((i) => Math.min(i + 1, matches.length))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setActive((i) => Math.max(i - 1, 0))
              } else if (e.key === "Enter" && e.altKey) {
                e.preventDefault()
                submit(true)
              } else if (e.key === "Escape") {
                e.stopPropagation()
                setQ("")
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            placeholder={bang ? `Search ${bang.shortcut.name || bang.shortcut.key}` : searchApps ? `Search apps or ${engineName}` : `Search ${engineName}`}
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            autoComplete="off"
            spellCheck={false}
          />
          {bang ? (
            <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">{bang.shortcut.name || bang.shortcut.key}</span>
          ) : (
            <kbd className="hidden rounded-md border px-1.5 font-kbd text-xs text-muted-foreground @[22rem]:inline">/</kbd>
          )}
        </label>
      </form>

      {open && rect && createPortal(
        // Positioned in screen pixels; the list inside gets the block's zoom.
        <div className="fixed z-50" style={{ left: rect.left, top: rect.bottom + 6, width: rect.width }}>
          <ul
            id={listId}
            role="listbox"
            style={zoom !== 1 ? { zoom } : undefined}
            className="overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-2xl"
          >
            {matches.map((app, i) => (
              <li
                key={app.id}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  launch(app, e.altKey)
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm",
                  i === active && "bg-accent",
                )}
              >
                <AppIcon app={app} className="size-5 text-[0.65rem]" />
                <span className="font-medium">{app.name}</span>
                <span className="truncate text-muted-foreground">{app.description}</span>
              </li>
            ))}
            <li
              role="option"
              aria-selected={active === matches.length}
              onMouseEnter={() => setActive(matches.length)}
              onMouseDown={(e) => {
                e.preventDefault()
                go(fillTemplate(template, q.trim()))
              }}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm text-muted-foreground",
                active === matches.length && "bg-accent text-accent-foreground",
              )}
            >
              <Search className="size-4" aria-hidden />
              Search {engineName} for “{q.trim()}”
            </li>
          </ul>
        </div>,
        document.body,
      )}
    </div>
  )
}
