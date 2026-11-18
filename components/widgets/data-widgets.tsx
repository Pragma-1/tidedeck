"use client"

import { usePolling } from "@/hooks/use-polling"
import type { BlockOf } from "@/lib/schema"
import { cn, formatBytes, formatDuration, isSafeHref } from "@/lib/utils"

// --- Server resources -------------------------------------------------------

type SystemStats = {
  cpu: { percent: number; cores: number; load: number[] }
  memory: { total: number; used: number; percent: number }
  disk: { path: string; total: number; used: number; percent: number } | { path: string; error: string }
  uptime: number
}

function Meter({ label, value, detail }: { label: string; value: number; detail: string }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="truncate text-xs text-muted-foreground tabular-nums">{detail}</span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-700", pct >= 90 ? "bg-down" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function SystemWidget({ block }: { block: BlockOf<"system"> }) {
  const { showCpu, showMemory, showDisk, showUptime } = block.props
  const { data, error } = usePolling<SystemStats>(`/api/system?block=${encodeURIComponent(block.id)}`, 5000)

  if (error && !data) return <p className="px-4 pb-4 text-sm text-muted-foreground">{error}</p>
  if (!data) return <div className="mx-4 mb-4 h-24 animate-pulse rounded-lg bg-muted/60" aria-label="Loading" />

  return (
    <div className="flex h-full flex-col gap-3.5 px-4 pb-4">
      {showCpu && (
        <Meter label="CPU" value={data.cpu.percent} detail={`${data.cpu.percent.toFixed(0)}% of ${data.cpu.cores} cores`} />
      )}
      {showMemory && (
        <Meter
          label="Memory"
          value={data.memory.percent}
          detail={`${formatBytes(data.memory.used)} of ${formatBytes(data.memory.total)}`}
        />
      )}
      {showDisk &&
        ("error" in data.disk ? (
          <p className="text-xs text-muted-foreground">
            Disk {data.disk.path}: {data.disk.error}
          </p>
        ) : (
          <Meter
            label={`Disk ${data.disk.path}`}
            value={data.disk.percent}
            detail={`${formatBytes(data.disk.used)} of ${formatBytes(data.disk.total)}`}
          />
        ))}
      {showUptime && (
        <p className="mt-auto text-xs text-muted-foreground">
          Up {formatDuration(data.uptime)}, load {data.cpu.load.map((l) => l.toFixed(2)).join(" ")}
        </p>
      )}
    </div>
  )
}

// --- RSS --------------------------------------------------------------------

type FeedResponse = { items: Array<{ title: string; link: string; date: string | null; source: string }>; errors: string[] }

function ago(iso: string | null): string {
  if (!iso) return ""
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" })
  if (s < 3600) return rtf.format(-Math.max(1, Math.round(s / 60)), "minute")
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour")
  return rtf.format(-Math.round(s / 86400), "day")
}

export function RssWidget({ block, editing }: { block: BlockOf<"rss">; editing: boolean }) {
  const hasFeeds = block.props.feeds.some(Boolean)
  const key = `${block.id}:${block.props.feeds.join(",")}:${block.props.limit}`
  const { data, error } = usePolling<FeedResponse>(
    hasFeeds ? `/api/rss?block=${encodeURIComponent(block.id)}&k=${encodeURIComponent(key)}` : null,
    10 * 60_000,
  )

  if (!hasFeeds) {
    return <p className="px-4 pb-4 text-sm text-muted-foreground">{editing ? "Add a feed URL in this block's settings." : "No feeds yet."}</p>
  }
  if (error && !data) return <p className="px-4 pb-4 text-sm text-muted-foreground">{error}</p>
  if (!data) return <div className="mx-4 mb-4 h-24 animate-pulse rounded-lg bg-muted/60" aria-label="Loading" />

  return (
    <div className="h-full overflow-y-auto px-2 pb-2">
      {data.items.length === 0 && (
        <p className="px-2 text-sm text-muted-foreground">{data.errors[0] ?? "These feeds have no posts."}</p>
      )}
      <ul>
        {data.items.map((item, i) => (
          <li key={`${item.link}-${i}`}>
            <a
              href={isSafeHref(item.link) ? item.link : undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-md px-2 py-2 transition-colors hover:bg-accent/70"
            >
              <span className="line-clamp-2 text-sm leading-snug">{item.title}</span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {[block.props.showSource ? item.source : "", ago(item.date)].filter(Boolean).join(", ")}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

// --- Embeds ------------------------------------------------------------------
// (Notes are in notes-widget.tsx: the Markdown renderer is only loaded on boards that have notes.)

export function IframeWidget({ block, editing }: { block: BlockOf<"iframe">; editing: boolean }) {
  const { url, allowFullscreen } = block.props
  if (!url) {
    return <p className="px-4 pb-4 text-sm text-muted-foreground">{editing ? "Set a page address in the settings." : "Nothing to show."}</p>
  }
  return (
    <iframe
      src={url}
      title={block.title || "Embedded page"}
      loading="lazy"
      referrerPolicy="no-referrer"
      allowFullScreen={allowFullscreen}
      // No allow-top-navigation: an embedded page can't redirect the dashboard away.
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
      className="h-full w-full border-0 bg-white"
    />
  )
}
