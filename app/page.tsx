import { cookies } from "next/headers"
import { Dashboard } from "@/components/dashboard/dashboard"
import { Locked } from "@/components/dashboard/locked"
import { SESSION_COOKIE, getAuthState } from "@/lib/server/auth"
import { pruneSecrets } from "@/lib/server/secrets"
import { getConfig } from "@/lib/server/store"

export const dynamic = "force-dynamic"

export default async function Page({ searchParams }: { searchParams: Promise<{ board?: string }> }) {
  const [{ config, rev }, cookieStore, params] = await Promise.all([getConfig(), cookies(), searchParams])
  const auth = await getAuthState(cookieStore.get(SESSION_COOKIE)?.value)
  // Forget credentials of music blocks that were deleted (kept until the next page load so "Undo" still works).
  void pruneSecrets(new Set(config.boards.flatMap((b) => b.blocks.map((blk) => blk.id)))).catch(() => {})

  if (config.settings.requireLoginToView && !auth.authenticated) {
    return <Locked title={config.settings.title} />
  }
  return <Dashboard config={config} rev={rev} auth={auth} boardId={params.board} />
}
