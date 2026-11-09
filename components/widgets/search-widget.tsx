"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Search } from "lucide-react"
import { useDashboard } from "@/hooks/use-dashboard"
import { collectApps, type BlockOf } from "@/lib/schema"
import { cn, isSafeHref } from "@/lib/utils"
import { AppIcon } from "@/components/widgets/app-tile"

const ENGINES = {
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  google: { name: "Google", url: "https://www.google.com/search?q=%s" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q=%s" },
  startpage: { name: "Startpage", url: "https://www.startpage.com/do/search?q=%s" },
  brave: { name: "Brave Search", url: "https://search.brave.com/search?q=%s" },
  custom: { name: "your search engine", url: "" },
} as const

export const ENGINE_NAMES = Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v.name]))

export function SearchWidget({ block }: { block: BlockOf<"search"> }) {
  const { engine, customUrl, searchApps, newTab } = block.props
  const config = useDashboard((s) => s.config)
  const allApps = useMemo(() => collectApps(config), [config])
  const [q, setQ] = useState("")
  const [active, setActive] = useState(0)
  const listId = useId()
  const anchor = useRef<HTMLLabelElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [focused, setFocused] = useState(false)

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!searchApps || !term) return []
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

  const template = engine === "custom" ? customUrl : ENGINES[engine].url
  const engineName = ENGINES[engine].name

  const go = (url: string, sameTab = !newTab) => {
    if (!isSafeHref(url)) return
    if (sameTab) window.location.href = url
    else window.open(url, "_blank", "noopener,noreferrer")
    setQ("")
  }

  const submit = () => {
    const term = q.trim()
    if (!term) return
    const pick = matches[active]
    if (pick) return go(pick.url, pick.target === "same")
    if (/^https?:\/\/\S+$/i.test(term)) return go(term)
    if (template.includes("%s")) go(template.replace("%s", encodeURIComponent(term)))
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
        <label ref={anchor} className="flex h-12 items-center gap-3 rounded-lg bg-muted/70 px-3.5 ring-ring/40 transition-shadow focus-within:ring-2">
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
            placeholder={searchApps ? `Search apps or ${engineName}` : `Search ${engineName}`}
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden rounded border px-1.5 text-xs text-muted-foreground @[22rem]:inline">/</kbd>
        </label>
      </form>

      {open && rect && createPortal(
        <ul
          id={listId}
          role="listbox"
          style={{ position: "fixed", left: rect.left, top: rect.bottom + 6, width: rect.width }}
          className="z-50 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-2xl"
        >
          {matches.map((app, i) => (
            <li
              key={app.id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                go(app.url, app.target === "same")
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
              if (template.includes("%s")) go(template.replace("%s", encodeURIComponent(q.trim())))
            }}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm text-muted-foreground",
              active === matches.length && "bg-accent text-accent-foreground",
            )}
          >
            <Search className="size-4" aria-hidden />
            Search {engineName} for “{q.trim()}”
          </li>
        </ul>,
        document.body,
      )}
    </div>
  )
}
