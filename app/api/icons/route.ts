import type { NextRequest } from "next/server"
import { canEdit } from "@/lib/server/auth"
import { fail, json } from "@/lib/server/http"
import { MAX_ICON_BYTES, saveIcon } from "@/lib/server/icons"

export const dynamic = "force-dynamic"

/** Upload an icon: the raw file is the request body. */
export async function POST(req: NextRequest) {
  // The custom header can't be sent cross-site without a CORS preflight, which we never allow.
  const origin = req.headers.get("origin")
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host")
  let sameOrigin = true
  if (origin) {
    try {
      sameOrigin = new URL(origin).host === host
    } catch {
      sameOrigin = false
    }
  }
  if (req.headers.get("x-tidedeck-upload") !== "1" || !sameOrigin) {
    return fail(403, "Request rejected")
  }
  if (!(await canEdit(req))) return fail(401, "Sign in to edit")
  if (Number(req.headers.get("content-length") ?? 0) > MAX_ICON_BYTES) return fail(413, "Icons can be at most 1 MB")
  const buf = Buffer.from(await req.arrayBuffer())
  if (buf.length > MAX_ICON_BYTES) return fail(413, "Icons can be at most 1 MB")
  try {
    const name = await saveIcon(buf)
    return json({ url: `/api/icons/${name}` })
  } catch (err) {
    return fail(400, (err as Error).message)
  }
}
