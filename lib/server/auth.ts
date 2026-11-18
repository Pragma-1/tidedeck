import { createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import type { NextRequest } from "next/server"
import { DATA_DIR, getConfig } from "@/lib/server/store"

const AUTH_FILE = path.join(DATA_DIR, "auth.json")
export const SESSION_COOKIE = "td_session"
const SESSION_TTL_S = 30 * 24 * 3600
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 }
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 512

type AuthFile = { hash: string | null; secret: string; version: number }

type State = { file: AuthFile | null; loading: Promise<AuthFile> | null; setupCode: string | null }
const g = globalThis as unknown as { __tidedeckAuth?: State }
const state = (g.__tidedeckAuth ??= { file: null, loading: null, setupCode: null })

export const authDisabled = () => process.env.AUTH_DISABLED === "true"

// --- scrypt with a concurrency cap ----------------------------------------
// Each hash needs ~32 MB and ~100 ms of CPU. Without a cap, a flood of login
// requests could exhaust memory; with it they just queue.
const MAX_PARALLEL_HASHES = 2
let running = 0
const waiting: Array<() => void> = []

async function withHashSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL_HASHES) {
    if (waiting.length > 200) throw new Error("busy")
    await new Promise<void>((r) => waiting.push(r))
  }
  running++
  try {
    return await fn()
  } finally {
    running--
    waiting.shift()?.()
  }
}

function scrypt(password: string, salt: Buffer, opts: ScryptOptions & { keylen: number }) {
  return withHashSlot(
    () =>
      new Promise<Buffer>((resolve, reject) =>
        scryptCb(password.normalize("NFKC"), salt, opts.keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
      ),
  )
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, SCRYPT)
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$")
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, keyB64] = stored.split("$")
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false
  const expected = Buffer.from(keyB64, "base64")
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    keylen: expected.length,
    maxmem: SCRYPT.maxmem,
  })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

async function writeAuth(file: AuthFile) {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const tmp = `${AUTH_FILE}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(file, null, 2), { mode: 0o600 })
  await fs.rename(tmp, AUTH_FILE)
  state.file = file
}

/** Human-friendly one-time code, e.g. "K7QM-3XWD" (no 0/O/1/I). */
function makeSetupCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const pick = () => Array.from({ length: 4 }, () => abc[randomInt(abc.length)]).join("")
  return `${pick()}-${pick()}`
}

async function readAuthFile(): Promise<AuthFile | null> {
  let raw: string
  try {
    raw = await fs.readFile(AUTH_FILE, "utf8")
  } catch (err) {
    // Only a missing file means "first run". Any other error must not reset
    // the password (and with it the key that protects stored secrets).
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
    throw err
  }
  let parsed: Partial<AuthFile> | null = null
  try {
    parsed = JSON.parse(raw) as Partial<AuthFile>
  } catch {}
  if (!parsed || typeof parsed.secret !== "string" || parsed.secret.length < 32 || typeof parsed.version !== "number") {
    throw new Error(`${AUTH_FILE} is damaged. Restore it from a backup, or delete it to set a new password.`)
  }
  return { hash: typeof parsed.hash === "string" ? parsed.hash : null, secret: parsed.secret, version: parsed.version }
}

async function loadAuth(): Promise<AuthFile> {
  if (state.file) return state.file
  state.loading ??= (async () => {
    const existing = await readAuthFile()
    const file: AuthFile = existing ?? { hash: null, secret: randomBytes(32).toString("hex"), version: 1 }
    const seed = process.env.ADMIN_PASSWORD
    if (!file.hash && seed && seed.length >= MIN_PASSWORD_LENGTH) file.hash = await hashPassword(seed)
    if (!existing || file.hash !== existing.hash) await writeAuth(file)
    else state.file = file
    if (!file.hash && !authDisabled()) {
      // Whoever sets the first password must prove access to the server's logs,
      // so nobody who merely reaches the page can claim the dashboard.
      state.setupCode = makeSetupCode()
      console.log(`[tidedeck] No admin password set yet. Setup code: ${state.setupCode}`)
    }
    return file
  })().catch((err) => {
    // Fail closed, but try again on the next request (the file may be fixed meanwhile).
    state.loading = null
    console.error("[tidedeck] could not load auth.json:", (err as Error).message)
    throw err
  })
  return state.loading
}

function sign(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url")
}

export async function createSessionToken(): Promise<string> {
  const file = await loadAuth()
  const payload = `${Math.floor(Date.now() / 1000) + SESSION_TTL_S}.${file.version}`
  return `${payload}.${sign(file.secret, payload)}`
}

async function validSession(token: string | undefined): Promise<boolean> {
  if (!token || token.length > 200) return false
  const file = await loadAuth()
  const [exp, version, mac] = token.split(".")
  if (!exp || !version || !mac) return false
  const expected = Buffer.from(sign(file.secret, `${exp}.${version}`))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false
  return Number(version) === file.version && Number(exp) > Date.now() / 1000
}

export type AuthState = { configured: boolean; authenticated: boolean; disabled: boolean }

export async function getAuthState(token: string | undefined): Promise<AuthState> {
  if (authDisabled()) return { configured: true, authenticated: true, disabled: true }
  const file = await loadAuth()
  return { configured: !!file.hash, authenticated: !!file.hash && (await validSession(token)), disabled: false }
}

export const authFromRequest = (req: NextRequest) => getAuthState(req.cookies.get(SESSION_COOKIE)?.value)

/** Viewing is public unless "require sign-in to view" is on. */
export async function canView(req: NextRequest): Promise<boolean> {
  const { config } = await getConfig()
  if (!config.settings.requireLoginToView) return true
  return (await authFromRequest(req)).authenticated
}

export async function canEdit(req: NextRequest): Promise<boolean> {
  return (await authFromRequest(req)).authenticated
}

// --- Login throttling --------------------------------------------------------

const attempts = new Map<string, { fails: number; until: number; last: number }>()
let globalFails: number[] = []

/**
 * Which client this is. Headers set by a proxy in front of Tidedeck are used
 * in order of how hard they are to forge: Cloudflare overwrites
 * CF-Connecting-IP, proxies overwrite X-Real-IP, and in X-Forwarded-For only
 * the last entry was added by our own proxy (earlier ones come from the client).
 */
export function clientKey(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean)
  return (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || xff?.[xff.length - 1] || "direct").slice(0, 64)
}

export function lockedFor(key: string): number {
  const now = Date.now()
  const a = attempts.get(key)
  const own = a && a.until > now ? Math.ceil((a.until - now) / 1000) : 0
  // Many failures from everywhere at once (e.g. rotating addresses): slow everybody down a little.
  globalFails = globalFails.filter((t) => now - t < 10 * 60_000)
  const global = globalFails.length >= 50 ? 5 : 0
  return Math.max(own, global)
}

function recordFailure(key: string) {
  const now = Date.now()
  globalFails.push(now)
  const a = attempts.get(key) ?? { fails: 0, until: 0, last: now }
  // Forget old failures after a quiet day.
  if (now - a.last > 24 * 3600_000) a.fails = 0
  a.fails += 1
  a.last = now
  if (a.fails >= 5) a.until = now + Math.min(30_000 * 2 ** (a.fails - 5), 15 * 60_000)
  attempts.set(key, a)
  if (attempts.size > 10_000) {
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k)
  }
}

export async function login(key: string, password: string): Promise<boolean> {
  const file = await loadAuth()
  const ok = !!file.hash && password.length <= MAX_PASSWORD_LENGTH && (await verifyPassword(password, file.hash))
  if (ok) attempts.delete(key)
  else recordFailure(key)
  return ok
}

export type SetupResult = "ok" | "already-set" | "bad-code"

/** First run only: needs the setup code printed in the server log. */
export async function setupPassword(key: string, code: string, password: string): Promise<SetupResult> {
  const file = await loadAuth()
  if (file.hash) return "already-set"
  const expected = Buffer.from(state.setupCode ?? "")
  const given = Buffer.from(code.trim().toUpperCase())
  if (!state.setupCode || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    recordFailure(key)
    return "bad-code"
  }
  await writeAuth({ ...file, hash: await hashPassword(password) })
  state.setupCode = null
  attempts.delete(key)
  return "ok"
}

export async function changePassword(key: string, current: string, next: string): Promise<boolean> {
  if (!(await login(key, current))) return false
  const file = await loadAuth()
  // Bumping the version signs out every other session.
  await writeAuth({ ...file, hash: await hashPassword(next), version: file.version + 1 })
  return true
}

/** Invalidates every session, including stolen cookies. */
export async function signOutEverywhere() {
  const file = await loadAuth()
  await writeAuth({ ...file, version: file.version + 1 })
}

export function isHttps(req: NextRequest): boolean {
  return req.headers.get("x-forwarded-proto") === "https" || req.nextUrl.protocol === "https:"
}

/** Key material for encrypting other stored secrets (never sent to clients). */
export async function serverSecret(): Promise<string> {
  return (await loadAuth()).secret
}

export { SESSION_TTL_S }
