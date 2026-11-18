import type { NextRequest } from "next/server"
import { canView, clientKey } from "@/lib/server/auth"
import { fail } from "@/lib/server/http"
import { getConfig, onUpdate } from "@/lib/server/store"
import { buildId } from "@/lib/server/build"

export const dynamic = "force-dynamic"

const MAX_STREAMS = 200
// One client (a forgotten kiosk with 40 tabs, or someone hogging slots) can't take them all.
const MAX_PER_CLIENT = 24
type Streams = { open: number; perClient: Map<string, number>; enders?: Set<() => void>; hooked?: boolean; stopping?: boolean }
const g = globalThis as unknown as { __tidedeckStreams?: Streams }
const streams: Streams = (g.__tidedeckStreams ??= { open: 0, perClient: new Map() })
streams.perClient ??= new Map()
const enders = (streams.enders ??= new Set())

// On shutdown (an update, `docker stop`) the open streams are ended, so the server
// can stop at once and every tab reconnects to the new one straight away, instead
// of staying attached to the old process until it is killed.
if (!streams.hooked) {
  streams.hooked = true
  const endAll = () => {
    streams.stopping = true
    for (const end of [...enders]) end()
  }
  process.once("SIGTERM", endAll)
  process.once("SIGINT", endAll)
}

/** Server-sent events: tells every open tab when the config changes. */
export async function GET(req: NextRequest) {
  if (!(await canView(req))) return fail(401, "Sign in to view this dashboard")
  // Shutting down: tell the tab to come back in a moment, on a new connection (this
  // one closes), which then reaches the new server rather than this old one.
  if (streams.stopping)
    return new Response("retry: 1000\n\n", {
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "close" },
    })
  const who = clientKey(req)
  const mine = streams.perClient.get(who) ?? 0
  if (streams.open >= MAX_STREAMS || mine >= MAX_PER_CLIENT) return fail(503, "Too many open connections")
  const { rev } = await getConfig()
  const encoder = new TextEncoder()
  let closed = false
  streams.open++
  streams.perClient.set(who, mine + 1)
  let cleanup = () => {
    if (!closed) {
      closed = true
      streams.open--
      const left = (streams.perClient.get(who) ?? 1) - 1
      if (left > 0) streams.perClient.set(who, left)
      else streams.perClient.delete(who)
    }
  }

  let stop = () => {}
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }
      // The build goes along, so tabs still running an older one reload (see use-sync.ts).
      send(`retry: 3000\ndata: ${JSON.stringify({ rev, build: buildId() })}\n\n`)
      const off = onUpdate((next) => send(`data: ${JSON.stringify({ rev: next })}\n\n`))
      const ping = setInterval(() => send(`: ping\n\n`), 25_000)
      const release = cleanup
      cleanup = () => {
        off()
        clearInterval(ping)
        release()
      }
      const end = () => {
        enders.delete(end)
        cleanup()
        try {
          controller.close()
        } catch {}
      }
      enders.add(end)
      stop = end
      req.signal.addEventListener("abort", end)
    },
    cancel() {
      stop()
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  })
}
