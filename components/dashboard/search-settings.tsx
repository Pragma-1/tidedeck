"use client"

import { useState } from "react"
import { Plus, RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Field, ToggleRow, httpError } from "@/components/dashboard/fields"
import { DEFAULT_SHORTCUTS, ENGINE_IDS, ENGINE_NAMES, type EngineId } from "@/lib/search"
import type { Settings } from "@/lib/schema"

/** Quick launch and the search shortcuts every search box understands. */
export function SearchSettings({ settings, set }: { settings: Settings; set: (fn: (s: Settings) => void) => void }) {
  const s = settings.search
  const [key, setKey] = useState("")
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const keyOk = /^[a-z0-9]{1,12}$/.test(key)
  const taken = s.shortcuts.some((x) => x.key === key)
  const urlOk = /^https?:\/\//i.test(url.trim())

  return (
    <section className="grid gap-3.5">
      <h3 className="text-sm font-semibold">Quick launch and search</h3>
      <ToggleRow
        label="Quick launch"
        description="Ctrl+K (⌘K on a Mac) opens a search over every app on every board, typed addresses and the web. “/” opens it on boards without a search block."
        checked={s.quickLaunch}
        onCheckedChange={(v) => set((x) => void (x.search.quickLaunch = v))}
      />
      {s.quickLaunch && (
        <ToggleRow
          label="Start typing anywhere"
          description="Typing a letter on the dashboard opens quick launch with it. Edit mode is then Shift+E instead of E."
          checked={s.typeAnywhere}
          onCheckedChange={(v) => set((x) => void (x.search.typeAnywhere = v))}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Web search in quick launch">
          {(id) => (
            <Select value={s.engine} onValueChange={(v) => set((x) => void (x.search.engine = v as EngineId))}>
              <SelectTrigger id={id}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENGINE_IDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k === "custom" ? "Custom" : ENGINE_NAMES[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
        <ToggleRow label="Open results in a new tab" checked={s.newTab} onCheckedChange={(v) => set((x) => void (x.search.newTab = v))} />
      </div>
      {s.engine === "custom" && (
        <Field label="Search address" hint="Use %s where the search words go." error={httpError(s.customUrl)}>
          {(id) => (
            <Input id={id} value={s.customUrl} placeholder="https://searx.lan/search?q=%s" onChange={(e) => set((x) => void (x.search.customUrl = e.target.value))} />
          )}
        </Field>
      )}

      <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">Search shortcuts</span>
          <Button variant="ghost" size="sm" onClick={() => set((x) => void (x.search.shortcuts = structuredClone(DEFAULT_SHORTCUTS)))}>
            <RotateCcw /> Defaults
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Type <kbd className="rounded border px-1 font-kbd">!yt lofi</kbd> in any search box or quick launch to search YouTube. Works everywhere, for everyone.
        </p>
        <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border p-1">
          {s.shortcuts.map((sc, i) => (
            <li key={sc.key} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent/50">
              <kbd className="w-16 shrink-0 truncate font-kbd text-xs">!{sc.key}</kbd>
              <span className="w-28 shrink-0 truncate">{sc.name}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{sc.url}</span>
              <Button variant="ghost" size="icon" className="size-7" aria-label={`Remove !${sc.key}`} onClick={() => set((x) => void x.search.shortcuts.splice(i, 1))}>
                <Trash2 />
              </Button>
            </li>
          ))}
          {s.shortcuts.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">No shortcuts.</li>}
        </ul>
        {s.shortcuts.length < 40 && (
          <form
            className="grid gap-2 sm:grid-cols-[6rem_8rem_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault()
              if (!keyOk || taken || !urlOk) return
              set((x) => void x.search.shortcuts.push({ key, name: name.trim() || key, url: url.trim() }))
              setKey("")
              setName("")
              setUrl("")
            }}
          >
            <Input aria-label="Shortcut" value={key} maxLength={12} placeholder="key" onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))} />
            <Input aria-label="Name" value={name} maxLength={40} placeholder="Name" onChange={(e) => setName(e.target.value)} />
            <Input aria-label="Search address" value={url} placeholder="https://site/search?q=%s" onChange={(e) => setUrl(e.target.value)} />
            <Button type="submit" variant="secondary" disabled={!keyOk || taken || !urlOk}>
              <Plus /> Add
            </Button>
            {taken && <p className="text-xs text-destructive sm:col-span-4">!{key} already exists.</p>}
          </form>
        )}
      </div>
    </section>
  )
}
