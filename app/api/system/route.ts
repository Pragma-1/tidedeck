import type { NextRequest } from "next/server"
import { findBlock } from "@/lib/schema"
import { canView } from "@/lib/server/auth"
import { fail, json } from "@/lib/server/http"
import { getConfig } from "@/lib/server/store"
import { getSystemStats } from "@/lib/server/system"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  if (!(await canView(req))) return fail(401, "Sign in to view this dashboard")
  const { config } = await getConfig()
  const block = findBlock(config, req.nextUrl.searchParams.get("block") ?? "")
  const diskPath = block?.type === "system" ? block.props.diskPath : "/"
  return json(await getSystemStats(diskPath || "/"))
}
