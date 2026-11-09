import type { NextRequest } from "next/server"
import { findBlock, type BlockOf } from "@/lib/schema"
import { canEdit, canView } from "@/lib/server/auth"
import { fail, isTrustedMutation, json, readJson } from "@/lib/server/http"
import { getMusicAccount, setMusicAccount, type MusicAccount } from "@/lib/server/secrets"
import { getConfig } from "@/lib/server/store"
import {
  SubsonicError,
  endpointUrl,
  fetchRaw,
  library,
  ping,
  scrobble,
  tracks,
  type LibraryView,
} from "@/lib/server/subsonic"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ action: string }> }
const ID = /^[\w.:-]{1,128}$/
const VIEWS: LibraryView[] = ["recent", "newest", "frequent", "random", "starred", "playlists", "search"]

async function musicBlock(blockId: string | null): Promise<BlockOf<"music"> | null> {
  if (!blockId) return null
  const { config } = await getConfig()
  const block = findBlock(config, blockId)
  return block?.type === "music" ? block : null
}

/** Admins can always play; visitors only if the block allows it. */
async function playable(req: NextRequest, blockId: string | null) {
  const block = await musicBlock(blockId)
  if (!block) return { error: fail(404, "Music block not found") }
  const allowed = (await canEdit(req)) || (block.props.allowVisitors && (await canView(req)))
  if (!allowed) return { error: fail(401, "Sign in to play music") }
  const account = await getMusicAccount(block.id)
  if (!account) return { error: fail(409, "This player isn't connected to a server yet") }
  return { block, account }
}

const asError = (err: unknown) =>
  err instanceof SubsonicError ? fail(502, err.message) : (console.error("[tidedeck] music", err), fail(500, "Music request failed"))

export async function GET(req: NextRequest, { params }: Ctx) {
  const { action } = await params
  const sp = req.nextUrl.searchParams
  const blockId = sp.get("block")

  if (action === "account") {
    if (!(await canEdit(req))) return fail(401, "Sign in to edit")
    if (!(await musicBlock(blockId))) return fail(404, "Music block not found")
    const a = await getMusicAccount(blockId!)
    return json({
      configured: !!a,
      url: a?.url ?? "",
      username: a?.username ?? "",
      hasPassword: !!a?.password,
      hasApiKey: !!a?.apiKey,
      insecureTls: a?.insecureTls ?? true,
    })
  }

  const ctx = await playable(req, blockId)
  if ("error" in ctx) return ctx.error
  const { block, account } = ctx

  try {
    switch (action) {
      case "library": {
        const view = (sp.get("view") ?? "recent") as LibraryView
        if (!VIEWS.includes(view)) return fail(400, "Unknown view")
        const q = (sp.get("q") ?? "").slice(0, 200)
        return json(await library(account, view, q))
      }
      case "tracks": {
        const album = sp.get("album") ?? undefined
        const playlist = sp.get("playlist") ?? undefined
        if ((album && !ID.test(album)) || (playlist && !ID.test(playlist))) return fail(400, "Bad id")
        return json(await tracks(account, { album, playlist, random: !album && !playlist }))
      }
      case "stream": {
        const id = sp.get("id") ?? ""
        if (!ID.test(id)) return fail(400, "Bad id")
        const range = req.headers.get("range")
        const upstream = await fetchRaw(
          account,
          endpointUrl(account, "stream", { id, maxBitRate: block.props.maxBitRate || undefined }),
          { headers: range ? { range } : {}, signal: req.signal },
        )
        if (!upstream.ok && upstream.status !== 206) return fail(502, `Server answered HTTP ${upstream.status}`)
        const type = upstream.headers.get("content-type") ?? ""
        if (type.includes("json") || type.includes("xml")) return fail(502, "Server refused to stream this track")
        const headers = new Headers({ "cache-control": "private, no-store" })
        for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
          const v = upstream.headers.get(h)
          if (v) headers.set(h, v)
        }
        return new Response(upstream.body as unknown as BodyInit, { status: upstream.status, headers })
      }
      case "cover": {
        const id = sp.get("id") ?? ""
        if (!ID.test(id)) return fail(400, "Bad id")
        const size = Math.max(64, Math.min(1024, Number(sp.get("size")) || 300))
        const upstream = await fetchRaw(account, endpointUrl(account, "getCoverArt", { id, size }), {
          signal: AbortSignal.timeout(15_000),
        })
        const type = upstream.headers.get("content-type") ?? ""
        if (!upstream.ok || !type.startsWith("image/")) return fail(404, "No cover")
        return new Response(upstream.body as unknown as BodyInit, {
          headers: { "content-type": type, "cache-control": "private, max-age=86400" },
        })
      }
      default:
        return fail(404, "Unknown action")
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return new Response(null, { status: 499 })
    return asError(err)
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { action } = await params
  if (!isTrustedMutation(req)) return fail(403, "Request rejected")
  const body = (await readJson<Record<string, unknown>>(req, 20_000)) ?? {}
  const blockId = typeof body.block === "string" ? body.block : null

  if (action === "scrobble") {
    const ctx = await playable(req, blockId)
    if ("error" in ctx) return ctx.error
    const id = String(body.id ?? "")
    if (!ID.test(id)) return fail(400, "Bad id")
    try {
      await scrobble(ctx.account, id, body.submission === true)
      return json({ ok: true })
    } catch (err) {
      return asError(err)
    }
  }

  if (action === "account") {
    if (!(await canEdit(req))) return fail(401, "Sign in to edit")
    if (!(await musicBlock(blockId))) return fail(404, "Music block not found")
    const prev = await getMusicAccount(blockId!)
    const next: MusicAccount = {
      url: String(body.url ?? "").trim().slice(0, 2048),
      username: String(body.username ?? "").trim().slice(0, 200),
      // Empty fields keep what's stored, so the password never has to travel back to the browser.
      password: typeof body.password === "string" && body.password ? body.password.slice(0, 500) : prev?.password ?? "",
      apiKey: typeof body.apiKey === "string" && body.apiKey ? body.apiKey.slice(0, 500) : body.clearApiKey ? "" : prev?.apiKey ?? "",
      insecureTls: body.insecureTls !== false,
    }
    if (!/^https?:\/\//i.test(next.url)) return fail(400, "Server address must start with http:// or https://")
    if (!next.apiKey && (!next.username || !next.password)) return fail(400, "Enter a username and password, or an API key")
    try {
      const server = await ping(next)
      await setMusicAccount(blockId!, next)
      return json({ ok: true, server })
    } catch (err) {
      return err instanceof SubsonicError ? fail(400, err.message) : asError(err)
    }
  }

  return fail(404, "Unknown action")
}
