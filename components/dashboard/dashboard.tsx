"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { useApplyDisplay } from "@/hooks/use-display"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { DeckGrid } from "@/components/dashboard/deck-grid"
import { Header } from "@/components/dashboard/header"
import { useOverlay } from "@/hooks/use-overlay"
import { loadPart, setPageBuild, takeResumeEdit } from "@/lib/stale-build"
import { LocaleCtx } from "@/hooks/use-locale-context"
import type { LocaleContext } from "@/lib/locale-context"
import { DashboardProvider, getDashboard, useActiveBoard, useDashboard, type AuthInfo } from "@/hooks/use-dashboard"
import { player, usePlayer } from "@/hooks/use-player"
import { useStatusPolling } from "@/hooks/use-status"
import { useLiveSync, useShortcuts } from "@/hooks/use-sync"
import { fontHref, themeCss } from "@/lib/theme"
import type { App, DashboardConfig, Settings } from "@/lib/schema"
import { cn } from "@/lib/utils"

// Dialogs are loaded when first opened, not with the page. The ones visitors use
// (quick launch, apps on top of the dashboard, sign-in) are fetched once the
// browser is idle, so they still open at once; the editor's only for whoever may edit.
const loadQuickLaunch = () => import("@/components/dashboard/quick-launch").then((m) => m.QuickLaunch)
const loadOverlay = () => import("@/components/dashboard/app-overlay").then((m) => m.AppOverlay)
const loadAuth = () => import("@/components/dashboard/auth-dialog").then((m) => m.AuthDialog)
const loadBlockSettings = () => import("@/components/dashboard/block-settings").then((m) => m.BlockSettingsDialog)
const loadSettings = () => import("@/components/dashboard/settings-dialog").then((m) => m.SettingsDialog)
// Opening one when the page is out of date (a newer version was installed) reloads the page.
const QuickLaunch = dynamic(loadPart(loadQuickLaunch), { ssr: false })
const AppOverlay = dynamic(loadPart(loadOverlay), { ssr: false })
const AuthDialog = dynamic(loadPart(loadAuth), { ssr: false })
const BlockSettingsDialog = dynamic(loadPart(loadBlockSettings, { resumeEdit: true }), { ssr: false })
const SettingsDialog = dynamic(loadPart(loadSettings, { resumeEdit: true }), { ssr: false })

/** True from the first time `open` is true on (so a dialog keeps its closing animation). */
function useOnceOpen(open: boolean): boolean {
  const [seen, setSeen] = useState(open)
  if (open && !seen) setSeen(true)
  return seen || open
}

type Props = { config: DashboardConfig; rev: number; auth: AuthInfo; boardId?: string; locale: LocaleContext | null; build: string }

export function Dashboard({ config, rev, auth, boardId, locale, build }: Props) {
  setPageBuild(build)
  const activeBoardId = config.boards.some((b) => b.id === boardId) ? boardId! : config.boards[0].id
  return (
    <DashboardProvider init={{ config, rev, auth, activeBoardId }}>
      <LocaleCtx.Provider value={locale}>
        <TooltipProvider>
          <Shell />
        </TooltipProvider>
      </LocaleCtx.Provider>
    </DashboardProvider>
  )
}

function useAppearance(settings: Settings) {
  const css = themeCss(settings)
  const font = fontHref(settings.font)
  useEffect(() => {
    let el = document.getElementById("td-font") as HTMLLinkElement | null
    if (!font) return
    if (!el) {
      el = document.createElement("link")
      el.id = "td-font"
      el.rel = "stylesheet"
      document.head.appendChild(el)
    }
    if (el.getAttribute("href") !== font) el.setAttribute("href", font)
  }, [font])
  useEffect(() => {
    let el = document.getElementById("td-theme") as HTMLStyleElement | null
    if (!el) {
      el = document.createElement("style")
      el.id = "td-theme"
      document.head.appendChild(el)
    }
    el.textContent = css
  }, [css])

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
  const { mode, imageUrl, blur, dim } = settings.background
  if (mode !== "image" || !imageUrl) return null
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
  const board = useActiveBoard()
  useAppearance(settings)
  useApplyDisplay(settings.display)

  // Window width without the scrollbar, for .page-col.
  useEffect(() => {
    const set = () => document.documentElement.style.setProperty("--vw", `${document.documentElement.clientWidth}px`)
    set()
    // The vertical scrollbar can come and go without a resize event; watch the root box instead.
    const ro = new ResizeObserver(set)
    ro.observe(document.documentElement)
    return () => ro.disconnect()
  }, [])

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
  const kiosk = useKiosk()

  const signedIn = useDashboard((s) => s.auth.authenticated)
  // Back from a reload that opening edit mode needed (the page was out of date): open it again.
  useEffect(() => {
    if (takeResumeEdit() && getDashboard().auth.authenticated) getDashboard().requestEdit(true)
  }, [])
  const showQuick = useOnceOpen(useDashboard((s) => s.quickLaunch))
  const showOverlay = useOnceOpen(useOverlay((s) => s.open !== null))
  const showAuth = useOnceOpen(useDashboard((s) => s.authDialog !== null))
  const showBlockSettings = useOnceOpen(useDashboard((s) => s.editingBlockId !== null))
  const showSettings = useOnceOpen(useDashboard((s) => s.settingsOpen))
  useEffect(() => {
    // Just warming the cache: a failure here (offline, say) changes nothing.
    const quiet = (p: Promise<unknown>) => void p.catch(() => {})
    const warm = () => {
      quiet(loadQuickLaunch())
      quiet(loadOverlay())
      quiet(loadAuth())
      if (signedIn) {
        quiet(loadBlockSettings())
        quiet(loadSettings())
      }
    }
    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(warm, { timeout: 5000 })
      return () => cancelIdleCallback(id)
    }
    const t = setTimeout(warm, 2000)
    return () => clearTimeout(t)
  }, [signedIn])

  return (
    <>
      <Backdrop settings={settings} />
      {/* As wide as the board (plus the page margin), so the band spans the page when it scrolls sideways. */}
      <div className="min-w-full" style={{ width: "max(100%, calc(var(--board-right, 0px) + var(--page-pad)))" }}>
      {kiosk ? <KioskExit /> : <Header />}
      {/* Like Tidewiki's sheet, the board starts on top of the band's lower edge. */}
      <main
        className={cn("page-col relative px-4 sm:px-6 lg:px-10", kiosk ? "pt-4 pb-4" : "-mt-10 pb-20", translucent && "translucent")}
        style={{ "--card-alpha": settings.cardOpacity / 100 } as React.CSSProperties}
      >
        <DeckGrid key={board.id} board={board} />
      </main>
      </div>
      {showBlockSettings && <BlockSettingsDialog />}
      {showSettings && <SettingsDialog />}
      {showOverlay && <AppOverlay />}
      {showQuick && <QuickLaunch />}
      {showAuth && <AuthDialog />}
      <Toaster />
    </>
  )
}

/**
 * ?kiosk: no header and no editing, for wall screens. ?rotate=60 moves to the
 * next board every 60 s. The mouse pointer hides after a few idle seconds.
 */
function useKiosk() {
  const kiosk = useDashboard((s) => s.kiosk)
  const setKiosk = useDashboard((s) => s.setKiosk)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.has("kiosk")) setKiosk(true)
  }, [setKiosk])

  useEffect(() => {
    if (!kiosk) return
    const seconds = Number(new URLSearchParams(window.location.search).get("rotate"))
    const timers: number[] = []
    if (Number.isFinite(seconds) && seconds >= 10) {
      timers.push(
        window.setInterval(() => {
          const { config, activeBoardId, setActiveBoard } = getDashboard()
          if (config.boards.length < 2) return
          const i = config.boards.findIndex((b) => b.id === activeBoardId)
          setActiveBoard(config.boards[(i + 1) % config.boards.length].id)
        }, Math.min(seconds, 86_400) * 1000),
      )
    }
    let idle = 0
    const root = document.documentElement
    const wake = () => {
      root.classList.remove("kiosk-idle")
      window.clearTimeout(idle)
      idle = window.setTimeout(() => root.classList.add("kiosk-idle"), 4000)
    }
    wake()
    window.addEventListener("pointermove", wake)
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("[role=dialog]") && leaveKiosk()
    window.addEventListener("keydown", onKey)
    return () => {
      timers.forEach((t) => window.clearInterval(t))
      window.clearTimeout(idle)
      root.classList.remove("kiosk-idle")
      window.removeEventListener("pointermove", wake)
      window.removeEventListener("keydown", onKey)
    }
  }, [kiosk])
  return kiosk
}

function leaveKiosk() {
  getDashboard().setKiosk(false)
  const url = new URL(window.location.href)
  url.searchParams.delete("kiosk")
  url.searchParams.delete("rotate")
  window.history.replaceState(null, "", url)
}

/** Invisible corner: a double-click (or double-tap) brings the header back. */
function KioskExit() {
  return <button type="button" aria-label="Show the header" onDoubleClick={leaveKiosk} className="fixed top-0 left-0 z-40 size-12 opacity-0" />
}
