"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { CornerDownLeft, Globe, Search, Zap } from "lucide-react"
import { getDashboard, useDashboard } from "@/hooks/use-dashboard"
import { openLink, type OpenMode } from "@/hooks/use-overlay"
import { collectApps } from "@/lib/model"
import type { App } from "@/lib/schema"
import { ENGINE_NAMES, asUrl, engineTemplate, fillTemplate, parseShortcut } from "@/lib/search"
import { cn } from "@/lib/utils"
import { AppIcon } from "@/components/widgets/app-tile"

type Item =
  | { kind: "app"; app: App; board: string }
  | { kind: "url"; url: string }
  | { kind: "shortcut"; key: string; name: string; url: string | null; complete: boolean }
  | { kind: "web"; url: string | null; engine: string }

const host = (u: string) => {
  try {
    return new URL(u).host
  } catch {
    return ""
  }
}

/**
 * Quick launch: Ctrl/⌘+K (or "/" when the board has no search block, or just
 * typing when "Start typing anywhere" is on). Finds apps on every board, opens
 * typed addresses, runs search shortcuts (!yt …) and web searches.
 */
export function QuickLaunch() {
  const open = useDashboard((s) => s.quickLaunch)
  const setOpen = useDashboard((s) => s.setQuickLaunch)
  const config = useDashboard((s) => s.config)
  const search = config.settings.search
  const [q, setQ] = useState("")
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)

  // The key that opened it (when typing anywhere) becomes the first character.
  useEffect(() => {
    if (open) {
      setQ(getDashboard().quickLaunchSeed)
      setActive(0)
    }
  }, [open])

  const apps = useMemo(
    () => config.boards.flatMap((b) => collectApps({ ...config, boards: [b] }).map((app) => ({ app, board: b.name }))),
    [config],
  )

  const items = useMemo<Item[]>(() => {
    const term = q.trim()
    const out: Item[] = []
    const bang = parseShortcut(term, search.shortcuts)
    if (bang) {
      out.push({
        kind: "shortcut",
        key: bang.shortcut.key,
        name: bang.shortcut.name || bang.shortcut.key,
        url: fillTemplate(bang.shortcut.url, bang.term),
        complete: true,
      })
    } else if (/^![^\s]*$/.test(term)) {
      const k = term.slice(1).toLowerCase()
      for (const s of search.shortcuts.filter((s) => s.key.startsWith(k)).slice(0, 8)) {
        out.push({ kind: "shortcut", key: s.key, name: s.name || s.key, url: null, complete: false })
      }
    }
    if (!term.startsWith("!")) {
      const t = term.toLowerCase()
      const hits = t
        ? apps
            .filter(({ app }) => app.url && [app.name, app.description, host(app.url)].some((v) => v.toLowerCase().includes(t)))
            .sort((a, b) => Number(!a.app.name.toLowerCase().startsWith(t)) - Number(!b.app.name.toLowerCase().startsWith(t)))
        : apps.filter(({ app }) => app.url)
      for (const h of hits.slice(0, t ? 8 : 6)) out.push({ kind: "app", ...h })
      const url = asUrl(term)
      if (url) out.push({ kind: "url", url })
      if (term) {
        out.push({
          kind: "web",
          url: fillTemplate(engineTemplate(search.engine, search.customUrl), term),
          engine: ENGINE_NAMES[search.engine],
        })
      }
    }
    return out
  }, [q, apps, search])

  useEffect(() => setActive((a) => Math.min(a, Math.max(0, items.length - 1))), [items.length])
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  const run = (item: Item | undefined, mode?: OpenMode) => {
    if (!item) return
    const tab: OpenMode = search.newTab ? "new" : "same"
    if (item.kind === "shortcut" && !item.complete) {
      setQ(`!${item.key} `)
      input.current?.focus()
      return
    }
    setOpen(false)
    if (item.kind === "app") {
      const own: OpenMode = item.app.target === "same" ? "same" : item.app.target === "overlay" ? "overlay" : "new"
      return openLink(item.app.url, item.app.name, mode ?? own)
    }
    const url = item.url
    if (url) openLink(url, "", mode === "overlay" ? tab : (mode ?? tab))
  }

  const label = (item: Item) => {
    switch (item.kind) {
      case "app":
        return (
          <>
            <AppIcon app={item.app} className="size-6 text-[0.7rem]" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{item.app.name}</span>
              <span className="ml-2 text-muted-foreground">{item.app.description || host(item.app.url)}</span>
            </span>
            {config.boards.length > 1 && <span className="shrink-0 text-xs text-muted-foreground">{item.board}</span>}
          </>
        )
      case "url":
        return (
          <>
            <Globe className="size-5 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              Open <span className="font-medium">{item.url}</span>
            </span>
          </>
        )
      case "shortcut":
        return (
          <>
            <Zap className="size-5 text-primary" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              <kbd className="mr-2 rounded border px-1 font-kbd text-xs">!{item.key}</kbd>
              {item.complete ? (
                q.trim().includes(" ") ? (
                  <>
                    Search <span className="font-medium">{item.name}</span>
                  </>
                ) : (
                  <>
                    Open <span className="font-medium">{item.name}</span>
                  </>
                )
              ) : (
                <span className="font-medium">{item.name}</span>
              )}
            </span>
          </>
        )
      case "web":
        return (
          <>
            <Search className="size-5 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              Search {item.engine} for <span className="font-medium">&ldquo;{q.trim()}&rdquo;</span>
            </span>
          </>
        )
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            input.current?.focus()
          }}
          className="fixed top-[12vh] left-1/2 z-50 flex max-h-[70dvh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-[1.2rem_0.4rem_1rem_1rem] border bg-popover text-popover-foreground shadow-[var(--shadow)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]"
        >
          <DialogPrimitive.Title className="sr-only">Quick launch</DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b px-4">
            <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={input}
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setActive(0)
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault()
                  setActive((i) => Math.min(i + 1, items.length - 1))
                } else if (e.key === "ArrowUp") {
                  e.preventDefault()
                  setActive((i) => Math.max(i - 1, 0))
                } else if (e.key === "Tab" && items[active]?.kind === "shortcut") {
                  e.preventDefault()
                  run(items[active])
                } else if (e.key === "Enter") {
                  e.preventDefault()
                  run(items[active], e.altKey ? "overlay" : e.ctrlKey || e.metaKey ? "new" : undefined)
                }
              }}
              role="combobox"
              aria-expanded
              aria-controls="quick-launch-list"
              aria-activedescendant={items[active] ? `ql-${active}` : undefined}
              aria-autocomplete="list"
              placeholder="Apps, addresses, or search the web — !yt for shortcuts"
              className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <ul ref={list} id="quick-launch-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches.</li>}
            {items.map((item, i) => (
              <li
                key={i}
                id={`ql-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => run(item, e.altKey ? "overlay" : e.ctrlKey || e.metaKey ? "new" : undefined)}
                className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm", i === active && "bg-accent")}
              >
                {label(item)}
                {i === active && <CornerDownLeft className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
              </li>
            ))}
          </ul>
          <div className="hidden gap-4 border-t px-4 py-2 text-xs text-muted-foreground sm:flex">
            <span>
              <kbd className="font-kbd">↵</kbd> open
            </span>
            <span>
              <kbd className="font-kbd">Ctrl ↵</kbd> new tab
            </span>
            <span>
              <kbd className="font-kbd">Alt ↵</kbd> on top
            </span>
            <span className="ml-auto">
              <kbd className="font-kbd">!</kbd> shortcuts
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
