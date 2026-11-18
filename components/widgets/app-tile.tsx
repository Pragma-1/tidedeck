"use client"

import { useEffect, useRef, useState } from "react"
import { useAppStatus, type StatusResult } from "@/hooks/use-status"
import { resolveIcon } from "@/lib/icons"
import type { App } from "@/lib/schema"
import { cn, isSafeHref } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { openLink } from "@/hooks/use-overlay"
import { ArrowUpRight, ExternalLink, Link2, PanelTop } from "lucide-react"
import { SendAppItems } from "@/components/dashboard/send-to-board"

export function AppIcon({ app, className }: { app: Pick<App, "icon" | "url" | "name">; className?: string }) {
  const src = resolveIcon(app.icon, app.url)
  const [failed, setFailed] = useState<string | null>(null)
  const img = useRef<HTMLImageElement>(null)
  // An image that already failed before React hydrated never fires onError; check once after mount.
  useEffect(() => {
    const el = img.current
    if (el && src && el.complete && el.naturalWidth === 0) setFailed(src)
  }, [src])
  if (!src || failed === src) {
    return (
      <span
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center rounded-[28%] bg-primary/12 font-semibold text-primary",
          className,
        )}
      >
        {(app.name.trim()[0] ?? "?").toUpperCase()}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={img}
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(src)}
      className={cn("shrink-0 object-contain", className)}
    />
  )
}

function describe(s: StatusResult | undefined): string {
  if (!s) return "Checking…"
  if (s.ok) return `Online, ${s.ms} ms (HTTP ${s.code})`
  if (s.code) return `Error: HTTP ${s.code}`
  return `Offline: ${s.error ?? "no answer"}`
}

export function StatusDot({ app, className }: { app: App; className?: string }) {
  const status = useAppStatus(app.id)
  if (!app.statusCheck) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-label={describe(status)}
          // Lit green, lit and pulsing red, or an unlit ring while checking (see .led in globals.css).
          className={cn("led", !status ? "led-wait" : status.ok ? "led-ok" : "led-down", className)}
        />
      </TooltipTrigger>
      <TooltipContent>{describe(status)}</TooltipContent>
    </Tooltip>
  )
}

/**
 * A link to an app. Click opens it the app's way (new tab, same tab, overlay);
 * Alt+click opens the overlay, middle/Ctrl+click a new tab (browser default),
 * right-click shows every way to open it.
 */
export function AppLink({ app, blockId, className, children }: { app: App; blockId?: string; className?: string; children: React.ReactNode }) {
  const ok = isSafeHref(app.url)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={!ok}>
        <a
          href={ok ? app.url : undefined}
          target={app.target === "new" ? "_blank" : undefined}
          rel="noopener noreferrer"
          aria-disabled={!ok}
          onClick={(e) => {
            if (!ok || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return
            if (e.altKey || app.target === "overlay") {
              e.preventDefault()
              openLink(app.url, app.name, "overlay")
            }
          }}
          className={cn(
            "group/app outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !ok && "pointer-events-none opacity-60",
            className,
          )}
        >
          {children}
        </a>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{app.name || app.url}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => openLink(app.url, app.name, "same")}>
          <ArrowUpRight /> Open here
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => openLink(app.url, app.name, "new")}>
          <ExternalLink /> Open in new tab
        </ContextMenuItem>
        <ContextMenuItem disabled={!/^https?:\/\//i.test(app.url)} onSelect={() => openLink(app.url, app.name, "overlay")}>
          <PanelTop /> Open on top of the dashboard
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => openLink(app.url, app.name, "copy")}>
          <Link2 /> Copy link
        </ContextMenuItem>
        {blockId && <SendAppItems blockId={blockId} app={app} />}
      </ContextMenuContent>
    </ContextMenu>
  )
}
