"use client"

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"
import { Loader2, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { iconPreview, loadIconIndex, parseIcon, type IconEntry, type IconLibrary } from "@/lib/icons"
import { cn } from "@/lib/utils"
import { AppIcon } from "@/components/widgets/app-tile"

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string
  hint?: ReactNode
  error?: string | null
  children: (id: string) => ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

export function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export const httpError = (v: string) => (v && !/^https?:\/\//i.test(v.trim()) ? "Start with http:// or https://" : null)

type PickerTab = IconLibrary | "upload"

const TABS: Array<{ id: PickerTab; label: string }> = [
  { id: "selfhst", label: "selfh.st" },
  { id: "dashboard-icons", label: "dashboard-icons" },
  { id: "upload", label: "Upload" },
]

const PREFIX: Record<IconLibrary, string> = { selfhst: "sh:", "dashboard-icons": "di:" }
const VARIANTS = [
  { suffix: "", label: "Standard" },
  { suffix: "-light", label: "Light" },
  { suffix: "-dark", label: "Dark" },
] as const

/**
 * Icon chooser: search selfh.st/icons or dashboard-icons, pick a light or
 * dark variant, upload your own file, or paste any image link.
 */
export function IconPicker({ value, appUrl, appName, onChange }: { value: string; appUrl: string; appName: string; onChange: (v: string) => void }) {
  const parsed = parseIcon(value)
  const [tab, setTab] = useState<PickerTab>(
    parsed.kind === "dashboard-icons" ? "dashboard-icons" : parsed.kind === "upload" ? "upload" : "selfhst",
  )
  const [index, setIndex] = useState<Partial<Record<IconLibrary, IconEntry[]>>>({})
  const [loading, setLoading] = useState(false)
  const [term, setTerm] = useState("")

  useEffect(() => {
    if (tab === "upload" || index[tab]) return
    let cancelled = false
    setLoading(true)
    void loadIconIndex(tab).then((list) => {
      if (cancelled) return
      setIndex((i) => ({ ...i, [tab]: list }))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [tab, index])

  const lib = tab === "upload" ? null : tab
  const list = lib ? index[lib] : undefined

  const results = useMemo(() => {
    const t = term.trim().toLowerCase()
    if (!list || !t) return []
    return list
      .filter((e) => e.name.includes(t) || e.label.toLowerCase().includes(t))
      .sort((a, b) => Number(!a.name.startsWith(t)) - Number(!b.name.startsWith(t)) || a.name.length - b.name.length)
      .slice(0, 32)
  }, [list, term])

  // Variant buttons for the icon that's currently chosen from this library.
  const baseName = parsed.name.replace(/-(light|dark)$/, "")
  const suffix = parsed.name.slice(baseName.length)
  const current = lib && parsed.kind === lib ? list?.find((e) => e.name === baseName) : undefined

  return (
    <Field
      label="Icon"
      hint="Pick one below, paste any image link, or leave it empty to use the site's own favicon."
    >
      {(id) => (
        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <AppIcon app={{ icon: value, url: appUrl, name: appName }} className="size-9 rounded-md text-sm" />
            <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Favicon (automatic)" autoComplete="off" />
            {value && (
              <Button type="button" variant="ghost" size="icon" aria-label="Use the favicon instead" onClick={() => onChange("")}>
                <X />
              </Button>
            )}
          </div>

          <div className="rounded-lg border">
            <div className="flex gap-1 border-b p-1" role="tablist" aria-label="Icon source">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs transition-colors",
                    tab === t.id ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {lib ? (
              <div className="grid gap-2 p-2">
                <Input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder={!list ? "Loading icon list…" : list.length ? `Search ${list.length.toLocaleString()} icons` : "Icon list unavailable"}
                  aria-label={`Search ${lib === "selfhst" ? "selfh.st" : "dashboard-icons"}`}
                  autoComplete="off"
                />

                {loading && !list && <Loader2 className="mx-auto my-2 size-4 animate-spin text-muted-foreground" />}
                {list && list.length === 0 && (
                  <p className="text-xs text-muted-foreground">Couldn&apos;t load the icon list. You can still type a name above, for example {PREFIX[lib]}immich.</p>
                )}
                {term && list && list.length > 0 && results.length === 0 && <p className="text-xs text-muted-foreground">No icon with that name.</p>}

                {results.length > 0 && (
                  <div className="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto sm:grid-cols-8">
                    {results.map((e) => (
                      <button
                        key={e.name}
                        type="button"
                        title={e.label}
                        onClick={() => {
                          onChange(PREFIX[lib] + e.name)
                          setTerm("")
                        }}
                        className={cn(
                          "grid aspect-square place-items-center rounded-md p-1.5 hover:bg-accent",
                          current?.name === e.name && "bg-accent ring-1 ring-primary",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={iconPreview(lib, e.name)} alt={e.label} loading="lazy" className="size-full object-contain" />
                      </button>
                    ))}
                  </div>
                )}

                {current && !term && (current.light || current.dark) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-xs text-muted-foreground">{current.label}:</span>
                    {VARIANTS.filter((v) => v.suffix === "" || (v.suffix === "-light" ? current.light : current.dark)).map((v) => (
                      <button
                        key={v.label}
                        type="button"
                        aria-pressed={suffix === v.suffix}
                        onClick={() => onChange(PREFIX[lib] + current.name + v.suffix)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                          suffix === v.suffix ? "border-primary bg-primary/10" : "hover:bg-accent",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={iconPreview(lib, current.name + v.suffix)} alt="" className="size-4 object-contain" />
                        {v.label}
                      </button>
                    ))}
                  </div>
                )}

                <p className="text-[0.7rem] text-muted-foreground">
                  {lib === "selfhst" ? (
                    <>
                      Icons by{" "}
                      <a className="underline" href="https://selfh.st/icons/" target="_blank" rel="noopener noreferrer">
                        selfh.st/icons
                      </a>{" "}
                      (CC BY 4.0). Light variants suit dark themes, dark ones suit light themes.
                    </>
                  ) : (
                    <>
                      Icons by{" "}
                      <a className="underline" href="https://dashboardicons.com" target="_blank" rel="noopener noreferrer">
                        dashboard-icons
                      </a>
                      .
                    </>
                  )}
                </p>
              </div>
            ) : (
              <IconUpload onUploaded={onChange} />
            )}
          </div>
        </div>
      )}
    </Field>
  )
}

function IconUpload({ onUploaded }: { onUploaded: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false })
  const [over, setOver] = useState(false)

  const upload = async (file: File) => {
    if (file.size > 1024 * 1024) return setState({ busy: false, error: "Icons can be at most 1 MB" })
    setState({ busy: true })
    try {
      const res = await fetch("/api/icons", {
        method: "POST",
        headers: { "x-tidedeck-upload": "1", "content-type": file.type || "application/octet-stream" },
        body: file,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return setState({ busy: false, error: body.error ?? `Upload failed (${res.status})` })
      setState({ busy: false })
      onUploaded(body.url)
    } catch {
      setState({ busy: false, error: "Couldn't reach the server" })
    }
  }

  return (
    <div className="p-2">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files[0]
          if (f) void upload(f)
        }}
        className={cn(
          "flex w-full flex-col items-center gap-1.5 rounded-md border border-dashed px-3 py-5 text-center transition-colors",
          over ? "border-primary bg-primary/5" : "hover:bg-accent/50",
        )}
      >
        {state.busy ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : <Upload className="size-5 text-muted-foreground" />}
        <span className="text-sm">Choose an image or drop it here</span>
        <span className="text-xs text-muted-foreground">PNG, JPEG, WebP, GIF, ICO or SVG, up to 1 MB. Stored on this server.</span>
      </button>
      {state.error && <p className="mt-1.5 text-xs text-destructive">{state.error}</p>}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,.ico,.svg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
          e.target.value = ""
        }}
      />
    </div>
  )
}
