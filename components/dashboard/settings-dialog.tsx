"use client"

import { useRef, useState } from "react"
import { Download, LogOut, Upload } from "lucide-react"
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
import { getDashboard, useDashboard } from "@/hooks/use-dashboard"
import { ACCENT_PRESETS } from "@/lib/accent"
import { configSchema, type Settings } from "@/lib/schema"
import { cn } from "@/lib/utils"

export function SettingsDialog() {
  const open = useDashboard((s) => s.settingsOpen)
  const setOpen = useDashboard((s) => s.setSettingsOpen)
  const settings = useDashboard((s) => s.config.settings)
  const mutate = useDashboard((s) => s.mutate)
  const set = (fn: (s: Settings) => void) => mutate((cfg) => fn(cfg.settings))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-2xl">
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
            <AppearanceTab settings={settings} set={set} />
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

function AppearanceTab({ settings, set }: { settings: Settings; set: (fn: (s: Settings) => void) => void }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Default theme" hint="Each browser can still switch with the sun/moon button.">
          {(id) => (
            <Select value={settings.theme} onValueChange={(v) => set((s) => void (s.theme = v as Settings["theme"]))}>
              <SelectTrigger id={id}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="system">Follow device</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
        <Field label="Accent colour">
          {(id) => (
            <div className="flex items-center gap-1.5">
              {ACCENT_PRESETS.map((p) => (
                <button
                  key={p.hex}
                  type="button"
                  title={p.name}
                  aria-label={p.name}
                  aria-pressed={settings.accent.toLowerCase() === p.hex}
                  onClick={() => set((s) => void (s.accent = p.hex))}
                  className={cn(
                    "size-7 rounded-full ring-offset-2 ring-offset-popover transition-shadow",
                    settings.accent.toLowerCase() === p.hex && "ring-2 ring-foreground",
                  )}
                  style={{ background: p.hex }}
                />
              ))}
              <input
                id={id}
                type="color"
                aria-label="Custom accent colour"
                value={settings.accent}
                onChange={(e) => set((s) => void (s.accent = e.target.value))}
                className="ml-1 size-7 cursor-pointer rounded-full border bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
              />
            </div>
          )}
        </Field>
      </div>

      <Field label="Background image" hint="An image URL, or a file you put in the public folder (e.g. /backgrounds/sea.jpg). Leave empty for a plain background.">
        {(id) => (
          <Input
            id={id}
            value={settings.background.imageUrl}
            placeholder="https://…"
            onChange={(e) => set((s) => void (s.background.imageUrl = e.target.value))}
          />
        )}
      </Field>
      {settings.background.imageUrl && (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={`Blur ${settings.background.blur}px`}>
            {() => (
              <Slider aria-label="Background blur" min={0} max={40} value={[settings.background.blur]} onValueChange={([v]) => set((s) => void (s.background.blur = v))} />
            )}
          </Field>
          <Field label={`Darken ${settings.background.dim}%`}>
            {() => (
              <Slider aria-label="Background darkening" min={0} max={90} value={[settings.background.dim]} onValueChange={([v]) => set((s) => void (s.background.dim = v))} />
            )}
          </Field>
        </div>
      )}
      <Field label={`Block opacity ${settings.cardOpacity}%`} hint="Below 100% the background shows through, frosted.">
        {() => (
          <Slider aria-label="Block opacity" min={20} max={100} value={[settings.cardOpacity]} onValueChange={([v]) => set((s) => void (s.cardOpacity = v))} />
        )}
      </Field>
      <Field label="Custom CSS" hint="Applied after the built-in styles. Blocks have the class .block-surface.">
        {(id) => (
          <Textarea
            id={id}
            rows={4}
            spellCheck={false}
            value={settings.customCss}
            placeholder=".block-surface { border-radius: 4px; }"
            onChange={(e) => set((s) => void (s.customCss = e.target.value))}
          />
        )}
      </Field>
    </>
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
      <div className="border-t pt-4">
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
    </div>
  )
}
