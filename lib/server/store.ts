import { EventEmitter } from "node:events"
import { promises as fs } from "node:fs"
import path from "node:path"
import { configSchema, type DashboardConfig } from "@/lib/schema"
import { defaultConfig } from "@/lib/default-config"

export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "data"))
const CONFIG_FILE = path.join(DATA_DIR, "dashboard.json")
const BACKUP_DIR = path.join(DATA_DIR, "backups")
const BACKUP_EVERY_MS = 5 * 60 * 1000
const BACKUPS_KEPT = 20

type StoreState = {
  config: DashboardConfig
  rev: number
  loaded: Promise<void> | null
  writeChain: Promise<unknown>
  lastBackup: number
  emitter: EventEmitter
}

// Survives Next.js module duplication between route bundles in one process.
const g = globalThis as unknown as { __tidedeckStore?: StoreState }
const state: StoreState = (g.__tidedeckStore ??= {
  config: defaultConfig(),
  rev: 0,
  loaded: null,
  writeChain: Promise.resolve(),
  lastBackup: 0,
  emitter: Object.assign(new EventEmitter(), {}),
})
state.emitter.setMaxListeners(500)

export class ConflictError extends Error {
  constructor(public currentRev: number) {
    super("Configuration changed in another session")
  }
}

async function writeAtomic(file: string, data: string) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, data, { mode: 0o600 })
  await fs.rename(tmp, file)
}

async function load() {
  await fs.mkdir(DATA_DIR, { recursive: true })
  let text: string | null = null
  try {
    text = await fs.readFile(CONFIG_FILE, "utf8")
  } catch (err) {
    // Missing: first run. Anything else (permissions, too many open files):
    // fail and retry later instead of replacing the dashboard with the default.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }
  try {
    if (text === null) throw Object.assign(new Error("missing"), { code: "ENOENT" })
    const raw = JSON.parse(text) as { rev?: number; config?: unknown }
    state.config = configSchema.parse(raw.config)
    state.rev = typeof raw.rev === "number" && raw.rev > 0 ? raw.rev : 1
    // Early builds defaulted to a brass accent; move those dashboards to the shared Tide colour.
    if (state.config.settings.accent.toLowerCase() === "#c9a45c") {
      state.config.settings.accent = "#8eaedb"
      state.rev += 1
      await writeAtomic(CONFIG_FILE, JSON.stringify({ rev: state.rev, config: state.config }, null, 2))
    }
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT"
    if (!missing) {
      const broken = `${CONFIG_FILE}.broken-${Date.now()}`
      await fs.rename(CONFIG_FILE, broken).catch(() => {})
      console.error(`[tidedeck] dashboard.json was unreadable, moved to ${broken}:`, err)
    }
    // Damaged: fall back to the newest backup that still validates, else start fresh.
    const restored = missing ? null : await newestValidBackup()
    state.config = restored ?? defaultConfig()
    state.rev = 1
    if (restored) console.error("[tidedeck] restored the dashboard from the newest backup")
    await writeAtomic(CONFIG_FILE, JSON.stringify({ rev: state.rev, config: state.config }, null, 2))
  }
}

async function newestValidBackup(): Promise<DashboardConfig | null> {
  const files = await fs.readdir(BACKUP_DIR).catch(() => [] as string[])
  for (const f of files.filter((f) => f.startsWith("dashboard-")).sort().reverse()) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(BACKUP_DIR, f), "utf8")) as { config?: unknown }
      return configSchema.parse(raw.config)
    } catch {}
  }
  return null
}

export async function getConfig(): Promise<{ config: DashboardConfig; rev: number }> {
  state.loaded ??= load().catch((err) => {
    state.loaded = null
    console.error("[tidedeck] could not read dashboard.json:", (err as Error).message)
    throw err
  })
  await state.loaded
  return { config: state.config, rev: state.rev }
}

async function maybeBackup() {
  const now = Date.now()
  if (now - state.lastBackup < BACKUP_EVERY_MS) return
  state.lastBackup = now
  await fs.mkdir(BACKUP_DIR, { recursive: true })
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-")
  await fs.copyFile(CONFIG_FILE, path.join(BACKUP_DIR, `dashboard-${stamp}.json`)).catch(() => {})
  const files = (await fs.readdir(BACKUP_DIR)).filter((f) => f.startsWith("dashboard-")).sort()
  for (const old of files.slice(0, Math.max(0, files.length - BACKUPS_KEPT))) {
    await fs.unlink(path.join(BACKUP_DIR, old)).catch(() => {})
  }
}

/** Validates and persists a new config. Throws ConflictError when baseRev is stale. */
export async function saveConfig(input: unknown, baseRev: number | null) {
  await getConfig()
  const run = async () => {
    if (baseRev !== null && baseRev !== state.rev) throw new ConflictError(state.rev)
    const parsed = configSchema.parse(input)
    await maybeBackup()
    const rev = state.rev + 1
    await writeAtomic(CONFIG_FILE, JSON.stringify({ rev, config: parsed }, null, 2))
    state.config = parsed
    state.rev = rev
    state.emitter.emit("update", rev)
    return { config: parsed, rev }
  }
  const next = state.writeChain.then(run, run)
  state.writeChain = next.catch(() => {})
  return next
}

export function onUpdate(listener: (rev: number) => void) {
  state.emitter.on("update", listener)
  return () => state.emitter.off("update", listener)
}
