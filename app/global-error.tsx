"use client"

import { useEffect } from "react"
import { isChunkError, reloadForUpdate } from "@/lib/stale-build"

/** Last resort, when even the page frame fails: plain HTML, no styles needed. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const stale = isChunkError(error)
  useEffect(() => {
    console.error("Tidedeck:", error)
    if (stale) reloadForUpdate()
  }, [error, stale])
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#14161b", color: "#e8e8ea", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>{stale ? "Tidedeck was updated" : "Something went wrong"}</h1>
          <p style={{ fontSize: 14, opacity: 0.75 }}>
            {stale ? "This page is from the previous version. Reload to get the new one." : error.message || "The page ran into an error."}
          </p>
          <button type="button" onClick={() => window.location.reload()} style={{ font: "inherit", fontSize: 14, padding: "8px 14px", borderRadius: 8, border: "1px solid #444", background: "#2a2f3a", color: "inherit", cursor: "pointer" }}>
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
