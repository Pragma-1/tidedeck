import type { NextRequest } from "next/server"
import { findBlock } from "@/lib/schema"
import { canView } from "@/lib/server/auth"
import { fail, json } from "@/lib/server/http"
import { getFeed, type FeedItem } from "@/lib/server/rss"
import { getConfig } from "@/lib/server/store"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  if (!(await canView(req))) return fail(401, "Sign in to view this dashboard")
  const { config } = await getConfig()
  const block = findBlock(config, req.nextUrl.searchParams.get("block") ?? "")
  if (block?.type !== "rss") return fail(404, "Feed block not found")

  const results = await Promise.allSettled(block.props.feeds.filter(Boolean).map(getFeed))
  const items: FeedItem[] = []
  const errors: string[] = []
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value)
    else errors.push(`${block.props.feeds[i]}: ${(r.reason as Error).message}`)
  })
  items.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
  return json({ items: items.slice(0, block.props.limit), errors })
}
