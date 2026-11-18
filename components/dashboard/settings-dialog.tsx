"use client"

import { useEffect, useRef, useState } from "react"
import { Copy, Download, LogOut, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Field, ToggleRow } from "@/components/dashboard/fields"
import { postAuth } from "@/components/dashboard/auth-dialog"
import { SearchSettings } from "@/components/dashboard/search-settings"
import { LookSettings } from "@/components/dashboard/look-settings"
import { getDashboard, useDashboard } from "@/hooks/use-dashboard"
import { configSchema, type Settings } from "@/lib/schema"
import { MAX_IMPORT_BYTES, importDashboard, type ImportResult } from "@/lib/import-dashboards"
import { cn } from "@/lib/utils"

export function SettingsDialog() {
  const open = useDashboard((s) => s.settingsOpen)
  const setOpen = useDashboard((s) => s.setSettingsOpen)
  const settings = useDashboard((s) => s.config.settings)
  const mutate = useDashboard((s) => s.mutate)
  const set = (fn: (s: Settings) => void) => mutate((cfg) => fn(cfg.settings))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[max(1rem,6vh)] max-h-[calc(100dvh-max(2rem,12vh))] translate-y-0 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dashboard settings</DialogTitle>
          <DialogDescription>Changes apply right away and are saved for everyone.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="look">
          <TabsList>
            <TabsTrigger value="look">Look</TabsTrigger>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="account">Password</TabsTrigger>
            <TabsTrigger value="backup">Backup</TabsTrigger>
          </TabsList>

          <TabsContent value="look" className="grid gap-5">
            <LookSettings settings={settings} set={set} />
          </TabsContent>

          <TabsContent value="general" className="grid gap-5">
            <Field label="Dashboard name">
              {(id) => <Input id={id} value={settings.title} maxLength={60} onChange={(e) => set((s) => void (s.title = e.target.value))} />}
            </Field>
            <Field label={`Check app status every ${settings.statusInterval} seconds`}>
              {() => (
                <Slider
                  aria-label="Status check interval"
                  min={10}
                  max={300}
                  step={5}
                  value={[settings.statusInterval]}
                  onValueChange={([v]) => set((s) => void (s.statusInterval = v))}
                />
              )}
            </Field>
            <ToggleRow
              label="Require sign-in to view"
              description="When off, anyone who can reach the dashboard can look at it. Editing always needs the password."
              checked={settings.requireLoginToView}
              onCheckedChange={(v) => set((s) => void (s.requireLoginToView = v))}
            />
            <div className="border-t pt-5">
              <SearchSettings settings={settings} set={set} />
            </div>
            <KioskHelp />
          </TabsContent>

          <TabsContent value="account">
            <AccountTab />
          </TabsContent>

          <TabsContent value="backup">
            <BackupTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function AccountTab() {
  const auth = useDashboard((s) => s.auth)
  const setAuth = useDashboard((s) => s.setAuth)
  const setOpen = useDashboard((s) => s.setSettingsOpen)
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  if (auth.disabled) {
    return <p className="text-sm text-muted-foreground">Sign-in is turned off with AUTH_DISABLED=true. Protect the dashboard with your reverse proxy instead.</p>
  }

  return (
    <div className="grid gap-5">
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault()
          const r = await postAuth({ action: "change", current, next })
          setMsg(r.ok ? { ok: true, text: "Password changed. Other devices have been signed out." } : { ok: false, text: r.error })
          if (r.ok) {
            setCurrent("")
            setNext("")
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Current password">
            {(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
          </Field>
          <Field label="New password" hint="At least 8 characters.">
            {(id) => <Input id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
          </Field>
        </div>
        {msg && <p className={cn("text-sm", msg.ok ? "text-ok" : "text-destructive")}>{msg.text}</p>}
        <Button type="submit" variant="secondary" className="w-fit" disabled={!current || next.length < 8}>
          Change password
        </Button>
      </form>
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button
          variant="outline"
          onClick={async () => {
            const r = await postAuth({ action: "logout-all" })
            setMsg(r.ok ? { ok: true, text: "All other browsers and devices have been signed out." } : { ok: false, text: r.error })
          }}
        >
          Sign out everywhere else
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            await postAuth({ action: "logout" })
            setAuth({ ...auth, authenticated: false })
            setOpen(false)
            if (getDashboard().config.settings.requireLoginToView) window.location.reload()
          }}
        >
          <LogOut /> Sign out
        </Button>
      </div>
    </div>
  )
}

function BackupTab() {
  const replaceConfig = useDashboard((s) => s.replaceConfig)
  const fileRef = useRef<HTMLInputElement>(null)

  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(getDashboard().config, null, 2)], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `tidedeck-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const importConfig = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text())
      const parsed = configSchema.safeParse(raw.config ?? raw)
      if (!parsed.success) {
        const i = parsed.error.issues[0]
        toast.error("That file isn't a Tidedeck backup", { description: `${i.message} at ${i.path.join(" › ") || "top level"}` })
        return
      }
      const before = getDashboard().config
      replaceConfig(parsed.data)
      toast("Backup restored", { action: { label: "Undo", onClick: () => getDashboard().replaceConfig(before) } })
    } catch {
      toast.error("Couldn't read that file", { description: "Pick a .json file exported from Tidedeck." })
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Export everything (boards, blocks, settings) to a file, or restore from one. The server also keeps the last 20 versions in{" "}
        <code className="rounded bg-muted px-1">data/backups</code>, one every five minutes while you edit.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={exportConfig}>
          <Download /> Export backup
        </Button>
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload /> Restore from file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void importConfig(f)
            e.target.value = ""
          }}
        />
      </div>
      <ImportOther />
    </div>
  )
}

/** Moving over from Homepage, Dashy or Homer: their YAML becomes a new board. */
function ImportOther() {
  const mutate = useDashboard((s) => s.mutate)
  const setActiveBoard = useDashboard((s) => s.setActiveBoard)
  const setOpen = useDashboard((s) => s.setSettingsOpen)
  const fileRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState("")
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const read = (t: string) => {
    setError(null)
    setResult(null)
    if (!t.trim()) return
    try {
      setResult(importDashboard(t))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section className="grid gap-3 border-t pt-5">
      <h3 className="text-sm font-semibold">Import from another dashboard</h3>
      <p className="text-sm text-muted-foreground">
        Homepage (<code className="rounded bg-muted px-1">services.yaml</code>, <code className="rounded bg-muted px-1">bookmarks.yaml</code>), Dashy (
        <code className="rounded bg-muted px-1">conf.yml</code>) or Homer (<code className="rounded bg-muted px-1">config.yml</code>). Its groups of links
        become a new board; your current boards stay as they are.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload /> Choose a file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".yml,.yaml,.json,text/yaml,application/json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (!f) return
            if (f.size > MAX_IMPORT_BYTES) return setError("The file is larger than 1 MB.")
            const t = await f.text()
            setText(t)
            read(t)
          }}
        />
      </div>
      <Textarea
        aria-label="Or paste the file's content"
        rows={4}
        value={text}
        placeholder="…or paste the YAML here"
        className="font-mono text-xs"
        onChange={(e) => {
          setText(e.target.value)
          read(e.target.value)
        }}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
          <p className="min-w-0 flex-1 text-sm">
            {result.source}: {result.groups} {result.groups === 1 ? "group" : "groups"}, {result.apps} {result.apps === 1 ? "link" : "links"}
            {result.skipped > 0 && <span className="text-muted-foreground">, {result.skipped} skipped (no usable link)</span>}
          </p>
          <Button
            disabled={getDashboard().config.boards.length >= 50}
            onClick={() => {
              const board = result.board
              mutate((cfg) => void cfg.boards.push(board))
              setActiveBoard(board.id)
              setOpen(false)
              setText("")
              setResult(null)
              toast("Board added", { description: `“${board.name}” with ${result.apps} links. Turn on status dots per group in its settings.` })
            }}
          >
            Add as new board
          </Button>
        </div>
      )}
    </section>
  )
}

/** Wall-screen mode: a link without header or edit controls, optionally cycling through boards. */
function KioskHelp() {
  const boards = useDashboard((s) => s.config.boards)
  const active = useDashboard((s) => s.activeBoardId)
  const [rotate, setRotate] = useState(0)
  const [origin, setOrigin] = useState("")
  useEffect(() => setOrigin(window.location.origin), [])
  const board = boards.find((b) => b.id === active)
  const link = `${origin}/?board=${encodeURIComponent(active)}&kiosk${rotate ? `&rotate=${rotate}` : ""}`
  return (
    <section className="grid gap-3 border-t pt-5">
      <h3 className="text-sm font-semibold">Wall screen (kiosk)</h3>
      <p className="text-sm text-muted-foreground">
        Open this link on a TV or tablet: no header, no edit button, the board fills the screen. Esc or a double-tap in the top-left corner shows the
        header again.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(rotate)} onValueChange={(v) => setRotate(Number(v))}>
          <SelectTrigger className="w-56" aria-label="Cycle through boards">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Show “{board?.name}” only</SelectItem>
            {boards.length > 1 && (
              <>
                <SelectItem value="30">Next board every 30 s</SelectItem>
                <SelectItem value="60">Next board every minute</SelectItem>
                <SelectItem value="300">Next board every 5 min</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={() =>
            navigator.clipboard?.writeText(link).then(
              () => toast("Kiosk link copied", { description: link }),
              () => toast.error("Couldn't copy", { description: link }),
            )
          }
        >
          <Copy /> Copy link
        </Button>
      </div>
    </section>
  )
}
