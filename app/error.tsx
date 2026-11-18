"use client"

import { useEffect } from "react"
import { isChunkError, reloadForUpdate } from "@/lib/stale-build"

/**
 * Shown instead of the dashboard when something in it fails. If the cause is a
 * page that is out of date (Tidedeck was updated while it was open), it simply
 * reloads; otherwise it says what happened and offers to try again.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isChunkError(error)
  useEffect(() => {
    console.error("Tidedeck:", error)
    if (stale) reloadForUpdate()
  }, [error, stale])

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="block-surface w-full max-w-md rounded-[1.6rem_0.4rem_1rem_1rem] p-6">
        <h1 className="text-lg font-[650] tracking-[-0.01em]">{stale ? "Tidedeck was updated" : "Something went wrong"}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {stale
            ? "This page is from the previous version. Reload to get the new one."
            : "The dashboard ran into an error. Your saved boards are not affected."}
        </p>
        {!stale && (
          <p className="mt-3 rounded-md bg-muted px-3 py-2 font-kbd text-xs break-words text-muted-foreground">
            {error.message || "Unknown error"}
            {error.digest && <span className="block opacity-70">Reference: {error.digest}</span>}
          </p>
        )}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Reload
          </button>
          {!stale && (
            <button type="button" onClick={reset} className="rounded-lg border px-3.5 py-2 text-sm font-medium hover:bg-accent">
              Try again
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
