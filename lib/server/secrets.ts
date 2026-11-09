import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"
import { promises as fs } from "node:fs"
import path from "node:path"
import { serverSecret } from "@/lib/server/auth"
import { DATA_DIR } from "@/lib/server/store"

/**
 * Credentials for connected services, per block. Kept out of dashboard.json
 * (which every viewer can read) and encrypted with AES-256-GCM, using a key
 * derived from the server secret in auth.json. Copying secrets.json alone
 * gives nothing away; both files together do, so protect ./data.
 */

const FILE = path.join(DATA_DIR, "secrets.json")

export type MusicAccount = {
  url: string
  username: string
  password: string
  apiKey: string
  insecureTls: boolean
}

type Store = Record<string, MusicAccount>

const g = globalThis as unknown as { __tidedeckSecrets?: { data: Store | null; chain: Promise<unknown> } }
const state = (g.__tidedeckSecrets ??= { data: null, chain: Promise.resolve() })

async function key(): Promise<Buffer> {
  return Buffer.from(hkdfSync("sha256", await serverSecret(), "tidedeck", "secrets-v1", 32))
}

async function load(): Promise<Store> {
  if (state.data) return state.data
  try {
    const raw = JSON.parse(await fs.readFile(FILE, "utf8")) as { iv: string; tag: string; data: string }
    const d = createDecipheriv("aes-256-gcm", await key(), Buffer.from(raw.iv, "base64"))
    d.setAuthTag(Buffer.from(raw.tag, "base64"))
    const plain = Buffer.concat([d.update(Buffer.from(raw.data, "base64")), d.final()]).toString("utf8")
    state.data = JSON.parse(plain) as Store
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("[tidedeck] secrets.json could not be read:", err)
    state.data = {}
  }
  return state.data
}

async function persist(data: Store) {
  const iv = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", await key(), iv)
  const enc = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final()])
  const body = JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: enc.toString("base64") })
  const tmp = `${FILE}.${Date.now()}.tmp`
  await fs.writeFile(tmp, body, { mode: 0o600 })
  await fs.rename(tmp, FILE)
  state.data = data
}

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = state.chain.then(fn, fn)
  state.chain = next.catch(() => {})
  return next
}

export async function getMusicAccount(blockId: string): Promise<MusicAccount | null> {
  return (await load())[blockId] ?? null
}

export function setMusicAccount(blockId: string, account: MusicAccount) {
  return serial(async () => persist({ ...(await load()), [blockId]: account }))
}

/** Drops credentials of blocks that no longer exist. */
export function pruneSecrets(liveBlockIds: Set<string>) {
  return serial(async () => {
    const data = await load()
    const kept = Object.fromEntries(Object.entries(data).filter(([id]) => liveBlockIds.has(id)))
    if (Object.keys(kept).length !== Object.keys(data).length) await persist(kept)
  })
}
