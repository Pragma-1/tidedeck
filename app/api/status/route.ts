import type { NextRequest } from "next/server"
import { collectApps } from "@/lib/schema"
import { canView } from "@/lib/server/auth"
import { fail, json } from "@/lib/server/http"
import { checkApp } from "@/lib/server/status"
import { getConfig } from "@/lib/server/store"

export const dynamic = "force-dynamic"

// Only apps that exist in the saved config can be probed, so this
// endpoint can't be used to make the server request arbitrary URLs.
export async function GET(req: NextRequest) {
  if (!(await canView(req))) return fail(401, "Sign in to view this dashboard")
  const ids = new Set((req.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 300))
  const { config } = await getConfig()
  const apps = collectApps(config).filter((a) => ids.has(a.id) && a.statusCheck)
  const entries = await Promise.all(apps.map(async (a) => [a.id, await checkApp(a)] as const))
  return json(Object.fromEntries(entries))
}
