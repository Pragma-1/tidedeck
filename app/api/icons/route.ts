import type { NextRequest } from "next/server"
import { canEdit } from "@/lib/server/auth"
import { fail, isSameOrigin, json, readBody } from "@/lib/server/http"
import { MAX_ICON_BYTES, saveIcon } from "@/lib/server/icons"

export const dynamic = "force-dynamic"

/** Upload an icon: the raw file is the request body. */
export async function POST(req: NextRequest) {
  // The custom header can't be sent cross-site without a CORS preflight, which we never allow.
  if (req.headers.get("x-tidedeck-upload") !== "1" || !isSameOrigin(req)) {
    return fail(403, "Request rejected")
  }
  if (!(await canEdit(req))) return fail(401, "Sign in to edit")
  const buf = await readBody(req, MAX_ICON_BYTES)
  if (!buf) return fail(413, "Icons can be at most 1 MB")
  try {
    const name = await saveIcon(buf)
    return json({ url: `/api/icons/${name}` })
  } catch (err) {
    return fail(400, (err as Error).message)
  }
}
