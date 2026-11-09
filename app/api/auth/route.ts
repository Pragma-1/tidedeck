import type { NextRequest } from "next/server"
import {
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
} from "@/lib/server/auth"
import { fail, isTrustedMutation, json, readJson } from "@/lib/server/http"

export const dynamic = "force-dynamic"

type Body = { action?: string; password?: string; current?: string; next?: string }

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

export async function POST(req: NextRequest) {
  if (!isTrustedMutation(req)) return fail(403, "Request rejected")
  const body = (await readJson<Body>(req, 10_000)) ?? {}
  const key = clientKey(req)
  const state = await authFromRequest(req)
  if (state.disabled) return fail(400, "Sign-in is turned off (AUTH_DISABLED=true)")

  if (body.action === "logout") {
    const res = json({ ok: true })
    res.cookies.delete(SESSION_COOKIE)
    return res
  }

  const wait = lockedFor(key)
  if (wait > 0 && body.action !== "setup") return fail(429, `Too many attempts. Try again in ${wait} s.`, { retryAfter: wait })

  if (body.action === "setup") {
    const pw = body.password ?? ""
    if (pw.length < MIN_PASSWORD_LENGTH) return fail(400, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
    if (!(await setupPassword(pw))) return fail(409, "A password is already set. Sign in instead.")
    return withSession(req, { ok: true })
  }

  if (body.action === "login") {
    if (!state.configured) return fail(400, "No password set yet")
    if (!(await login(key, body.password ?? ""))) return fail(401, "Wrong password")
    return withSession(req, { ok: true })
  }

  if (body.action === "change") {
    if (!state.authenticated) return fail(401, "Sign in first")
    const next = body.next ?? ""
    if (next.length < MIN_PASSWORD_LENGTH) return fail(400, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
    if (!(await changePassword(key, body.current ?? "", next))) return fail(401, "Current password is wrong")
    return withSession(req, { ok: true })
  }

  return fail(400, "Unknown action")
}
