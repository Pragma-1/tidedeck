"use client"

import { useState } from "react"
import { useAppStatus, type StatusResult } from "@/hooks/use-status"
import { resolveIcon } from "@/lib/icons"
import type { App } from "@/lib/schema"
import { cn, isSafeHref } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function AppIcon({ app, className }: { app: Pick<App, "icon" | "url" | "name">; className?: string }) {
  const src = resolveIcon(app.icon, app.url)
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) {
    return (
      <span
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center rounded-[28%] bg-primary/15 font-display font-semibold text-primary",
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
          className={cn(
            "inline-block size-2 shrink-0 rounded-full ring-2 ring-card transition-colors",
            !status && "bg-muted-foreground/40",
            status?.ok && "bg-ok",
            status && !status.ok && "bg-down",
            className,
          )}
        />
      </TooltipTrigger>
      <TooltipContent>{describe(status)}</TooltipContent>
    </Tooltip>
  )
}

export function AppLink({ app, className, children }: { app: App; className?: string; children: React.ReactNode }) {
  const ok = isSafeHref(app.url)
  return (
    <a
      href={ok ? app.url : undefined}
      target={app.target === "new" ? "_blank" : undefined}
      rel="noopener noreferrer"
      aria-disabled={!ok}
      className={cn(
        "group/app outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !ok && "pointer-events-none opacity-60",
        className,
      )}
    >
      {children}
    </a>
  )
}
