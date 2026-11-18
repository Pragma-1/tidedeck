import { readFileSync } from "node:fs"
import path from "node:path"

let cached: string | null = null

/**
 * The running build's ID (Next.js writes a new one for every build). Tabs get it
 * with the page and again from live sync, so a tab from an older build notices
 * an update. "dev" when there is none (development server).
 */
export function buildId(): string {
  if (cached) return cached
  try {
    const id = readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim()
    cached = /^[\w-]{1,64}$/.test(id) ? id : "dev"
  } catch {
    cached = "dev"
  }
  return cached
}
