import type { NextRequest } from "next/server"
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  SESSION_COOKIE,
  SESSION_TTL_S,
  authFromRequest,
  changePassword,
  clientKey,
  createSessionToken,
  isHttps,
  lockedFor,
  login,
  setupPassword,
  signOutEverywhere,
} from "@/lib/server/auth"
import { fail, isTrustedMutation, json, readJson } from "@/lib/server/http"

export const dynamic = "force-dynamic"

type Body = { action?: unknown; password?: unknown; current?: unknown; next?: unknown; code?: unknown }
const str = (v: unknown) => (typeof v === "string" ? v : "")

export async function GET(req: NextRequest) {
  return json(await authFromRequest(req))
}

async function withSession(req: NextRequest, body: unknown) {
  const res = json(body)
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps(req),
    path: "/",
    maxAge: SESSION_TTL_S,
  })
  return res
}

const badLength = (pw: string) =>
  pw.length < MIN_PASSWORD_LENGTH
    ? `Use at least ${MIN_PASSWORD_LENGTH} characters`
    : pw.length > MAX_PASSWORD_LENGTH
      ? `Use at most ${MAX_PASSWORD_LENGTH} characters`
      : null

export async function POST(req: NextRequest) {
  if (!isTrustedMutation(req)) return fail(403, "Request rejected")
  const body = (await readJson<Body>(req, 4_096)) ?? {}
  const action = str(body.action)
  const key = clientKey(req)
  const state = await authFromRequest(req)
  if (state.disabled) return fail(400, "Sign-in is turned off (AUTH_DISABLED=true)")

  if (action === "logout") {
    const res = json({ ok: true })
    res.cookies.delete(SESSION_COOKIE)
    return res
  }

  const wait = lockedFor(key)
  if (wait > 0) return fail(429, `Too many attempts. Try again in ${wait} s.`, { retryAfter: wait })

  try {
    if (action === "setup") {
      const pw = str(body.password)
      const err = badLength(pw)
      if (err) return fail(400, err)
      const r = await setupPassword(key, str(body.code), pw)
      if (r === "already-set") return fail(409, "A password is already set. Sign in instead.")
      if (r === "bad-code") return fail(401, "Wrong setup code. It's in the server log (docker logs tidedeck).")
      return withSession(req, { ok: true })
    }

    if (action === "login") {
      if (!state.configured) return fail(400, "No password set yet")
      if (!(await login(key, str(body.password)))) return fail(401, "Wrong password")
      return withSession(req, { ok: true })
    }

    if (action === "change") {
      if (!state.authenticated) return fail(401, "Sign in first")
      const next = str(body.next)
      const err = badLength(next)
      if (err) return fail(400, err)
      if (!(await changePassword(key, str(body.current), next))) return fail(401, "Current password is wrong")
      return withSession(req, { ok: true })
    }

    if (action === "logout-all") {
      if (!state.authenticated) return fail(401, "Sign in first")
      await signOutEverywhere()
      // Keep this browser signed in with a fresh session.
      return withSession(req, { ok: true })
    }
  } catch (err) {
    if ((err as Error).message === "busy") return fail(503, "Server busy, try again in a moment")
    throw err
  }

  return fail(400, "Unknown action")
}
