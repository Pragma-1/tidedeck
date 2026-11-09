import { promises as fs } from "node:fs"
import path from "node:path"
import type { NextRequest } from "next/server"
import { canView } from "@/lib/server/auth"
import { fail } from "@/lib/server/http"
import { ICON_DIR, ICON_FILE, ICON_TYPES } from "@/lib/server/icons"
import { getConfig } from "@/lib/server/store"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  if (!ICON_FILE.test(file)) return fail(404, "Not found")
  if (!(await canView(req))) return fail(401, "Sign in to view this dashboard")
  let data: Buffer
  try {
    data = await fs.readFile(path.join(ICON_DIR, file))
  } catch {
    return fail(404, "Not found")
  }
  const { config } = await getConfig()
  const ext = file.split(".").pop()!
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": ICON_TYPES[ext],
      // File names are content hashes, so they never change.
      "cache-control": `${config.settings.requireLoginToView ? "private" : "public"}, max-age=31536000, immutable`,
      // An SVG opened directly must not be able to run scripts on this origin.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      "x-content-type-options": "nosniff",
    },
  })
}
