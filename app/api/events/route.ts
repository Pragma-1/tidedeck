import type { NextRequest } from "next/server"
import { canView } from "@/lib/server/auth"
import { fail } from "@/lib/server/http"
import { getConfig, onUpdate } from "@/lib/server/store"

export const dynamic = "force-dynamic"

/** Server-sent events: tells every open tab when the config changes. */
export async function GET(req: NextRequest) {
  if (!(await canView(req))) return fail(401, "Sign in to view this dashboard")
  const { rev } = await getConfig()
  const encoder = new TextEncoder()
  let cleanup = () => {}

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }
      send(`retry: 3000\ndata: ${JSON.stringify({ rev })}\n\n`)
      const off = onUpdate((next) => send(`data: ${JSON.stringify({ rev: next })}\n\n`))
      const ping = setInterval(() => send(`: ping\n\n`), 25_000)
      cleanup = () => {
        off()
        clearInterval(ping)
      }
      req.signal.addEventListener("abort", () => {
        cleanup()
        try {
          controller.close()
        } catch {}
      })
    },
    cancel() {
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
