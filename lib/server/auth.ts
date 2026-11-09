import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import type { NextRequest } from "next/server"
import { DATA_DIR, getConfig } from "@/lib/server/store"

const AUTH_FILE = path.join(DATA_DIR, "auth.json")
export const SESSION_COOKIE = "td_session"
const SESSION_TTL_S = 30 * 24 * 3600
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 }
export const MIN_PASSWORD_LENGTH = 8

type AuthFile = { hash: string | null; secret: string; version: number }

const g = globalThis as unknown as { __tidedeckAuth?: { file: AuthFile | null; loading: Promise<AuthFile> | null } }
const state = (g.__tidedeckAuth ??= { file: null, loading: null })

export const authDisabled = () => process.env.AUTH_DISABLED === "true"

function scrypt(password: string, salt: Buffer, opts: ScryptOptions & { keylen: number }) {
  return new Promise<Buffer>((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, opts.keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
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
    N: Number(n), r: Number(r), p: Number(p), keylen: expected.length, maxmem: SCRYPT.maxmem,
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

async function loadAuth(): Promise<AuthFile> {
  if (state.file) return state.file
  state.loading ??= (async () => {
    let file: AuthFile
    try {
      file = JSON.parse(await fs.readFile(AUTH_FILE, "utf8")) as AuthFile
    } catch {
      file = { hash: null, secret: randomBytes(32).toString("hex"), version: 1 }
    }
    const seed = process.env.ADMIN_PASSWORD
    if (!file.hash && seed && seed.length >= MIN_PASSWORD_LENGTH) file.hash = await hashPassword(seed)
    await writeAuth(file)
    return file
  })()
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
  if (!token) return false
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

/** Viewing is public unless "require login to view" is on. */
export async function canView(req: NextRequest): Promise<boolean> {
  const { config } = await getConfig()
  if (!config.settings.requireLoginToView) return true
  return (await authFromRequest(req)).authenticated
}

export async function canEdit(req: NextRequest): Promise<boolean> {
  return (await authFromRequest(req)).authenticated
}

// --- Login throttling: escalating lockout per client address -------------
const attempts = new Map<string, { fails: number; until: number }>()

export function clientKey(req: NextRequest): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  )
}

export function lockedFor(key: string): number {
  const a = attempts.get(key)
  return a && a.until > Date.now() ? Math.ceil((a.until - Date.now()) / 1000) : 0
}

function recordFailure(key: string) {
  const a = attempts.get(key) ?? { fails: 0, until: 0 }
  a.fails += 1
  if (a.fails >= 5) a.until = Date.now() + Math.min(30_000 * 2 ** (a.fails - 5), 15 * 60_000)
  attempts.set(key, a)
}

export async function login(key: string, password: string): Promise<boolean> {
  const file = await loadAuth()
  const ok = !!file.hash && (await verifyPassword(password, file.hash))
  if (ok) attempts.delete(key)
  else recordFailure(key)
  return ok
}

/** First-run: only allowed while no password exists. */
export async function setupPassword(password: string): Promise<boolean> {
  const file = await loadAuth()
  if (file.hash) return false
  await writeAuth({ ...file, hash: await hashPassword(password) })
  return true
}

export async function changePassword(key: string, current: string, next: string): Promise<boolean> {
  if (!(await login(key, current))) return false
  const file = await loadAuth()
  // Bumping the version signs out every other session.
  await writeAuth({ ...file, hash: await hashPassword(next), version: file.version + 1 })
  return true
}

export function isHttps(req: NextRequest): boolean {
  return req.headers.get("x-forwarded-proto") === "https" || req.nextUrl.protocol === "https:"
}

export { SESSION_TTL_S }

/** Key material for encrypting other stored secrets (never sent to clients). */
export async function serverSecret(): Promise<string> {
  return (await loadAuth()).secret
}
