"use client"

import { useEffect, useMemo } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { AuthDialog } from "@/components/dashboard/auth-dialog"
import { BlockSettingsDialog } from "@/components/dashboard/block-settings"
import { DeckGrid } from "@/components/dashboard/deck-grid"
import { Header } from "@/components/dashboard/header"
import { SettingsDialog } from "@/components/dashboard/settings-dialog"
import { DashboardProvider, useActiveBoard, useDashboard, type AuthInfo } from "@/hooks/use-dashboard"
import { player, usePlayer } from "@/hooks/use-player"
import { useStatusPolling } from "@/hooks/use-status"
import { useLiveSync, useShortcuts } from "@/hooks/use-sync"
import { accentVars } from "@/lib/accent"
import type { App, DashboardConfig, Settings } from "@/lib/schema"
import { cn } from "@/lib/utils"

type Props = { config: DashboardConfig; rev: number; auth: AuthInfo; boardId?: string }

export function Dashboard({ config, rev, auth, boardId }: Props) {
  const activeBoardId = config.boards.some((b) => b.id === boardId) ? boardId! : config.boards[0].id
  return (
    <DashboardProvider init={{ config, rev, auth, activeBoardId }}>
      <TooltipProvider>
        <Shell />
      </TooltipProvider>
    </DashboardProvider>
  )
}

function useAppearance(settings: Settings) {
  useEffect(() => {
    const root = document.documentElement
    for (const [k, v] of Object.entries(accentVars(settings.accent))) root.style.setProperty(k, v)
  }, [settings.accent])

  useEffect(() => {
    let el = document.getElementById("td-custom-css") as HTMLStyleElement | null
    if (!el) {
      el = document.createElement("style")
      el.id = "td-custom-css"
      document.head.appendChild(el)
    }
    el.textContent = settings.customCss
  }, [settings.customCss])

  useEffect(() => {
    document.title = settings.title || "Tidedeck"
  }, [settings.title])
}

function Backdrop({ settings }: { settings: Settings }) {
  const { imageUrl, blur, dim } = settings.background
  if (!imageUrl) return null
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute -inset-10 bg-cover bg-center"
        style={{ backgroundImage: `url(${JSON.stringify(imageUrl)})`, filter: blur ? `blur(${blur}px)` : undefined }}
      />
      <div className="absolute inset-0 bg-background" style={{ opacity: dim / 100 }} />
    </div>
  )
}

function Shell() {
  useLiveSync()
  useShortcuts()
  const settings = useDashboard((s) => s.config.settings)
  const editing = useDashboard((s) => s.editing)
  const board = useActiveBoard()
  useAppearance(settings)

  const watched = useMemo(() => {
    const apps: App[] = []
    for (const b of board.blocks) {
      if (b.type === "app") apps.push(b.props.app)
      if (b.type === "apps" && b.props.showStatus) apps.push(...b.props.apps)
    }
    return apps
  }, [board])
  useStatusPolling(watched, settings.statusInterval)

  // Stop the music if its block was deleted or switched away from Navidrome.
  const config = useDashboard((s) => s.config)
  const playingBlock = usePlayer((s) => s.blockId)
  useEffect(() => {
    if (!playingBlock) return
    const alive = config.boards.some((b) => b.blocks.some((x) => x.id === playingBlock && x.type === "music" && x.props.source === "navidrome"))
    if (!alive) player.stop()
  }, [config, playingBlock])

  const translucent = settings.cardOpacity < 100

  return (
    <>
      <Backdrop settings={settings} />
      <div
        className={cn("relative mx-auto max-w-[1680px] px-4 pt-6 pb-20 sm:px-6 lg:px-10 lg:pt-9", translucent && "translucent")}
        style={{ "--card-alpha": settings.cardOpacity / 100 } as React.CSSProperties}
      >
        <Header />
        {editing && (
          <p className="-mt-2 mb-3 text-xs text-muted-foreground">
            Drag a block to move it, pull any corner or edge to resize it, double-click it for settings. Press Esc when you’re done.
          </p>
        )}
        <main>
          <DeckGrid key={board.id} board={board} />
        </main>
      </div>
      <BlockSettingsDialog />
      <SettingsDialog />
      <AuthDialog />
      <Toaster />
    </>
  )
}
