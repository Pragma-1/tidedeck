import type { NextRequest } from "next/server"
import { ZodError } from "zod"
import { canEdit, canView } from "@/lib/server/auth"
import { fail, isTrustedMutation, json, readJson } from "@/lib/server/http"
import { ConflictError, getConfig, saveConfig } from "@/lib/server/store"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  if (!(await canView(req))) return fail(401, "Sign in to view this dashboard")
  return json(await getConfig())
}

export async function PUT(req: NextRequest) {
  if (!isTrustedMutation(req)) return fail(403, "Request rejected")
  if (!(await canEdit(req))) return fail(401, "Sign in to edit")
  const body = await readJson<{ baseRev?: number | null; config?: unknown }>(req)
  if (!body?.config) return fail(400, "Missing config")
  try {
    const { rev } = await saveConfig(body.config, typeof body.baseRev === "number" ? body.baseRev : null)
    return json({ rev })
  } catch (err) {
    if (err instanceof ConflictError) return json({ error: err.message, ...(await getConfig()) }, 409)
    if (err instanceof ZodError) {
      return fail(400, "Invalid configuration", {
        issues: err.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`),
      })
    }
    console.error("[tidedeck] save failed", err)
    return fail(500, "Could not write the configuration file")
  }
}
