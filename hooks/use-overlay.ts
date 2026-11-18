"use client"

import { create } from "zustand"
import { toast } from "sonner"
import { isSafeHref } from "@/lib/utils"

/** An app opened on top of the dashboard (Dashy calls it "modal"). */
export const useOverlay = create<{ open: { url: string; name: string } | null; set: (o: { url: string; name: string } | null) => void }>()(
  (set) => ({ open: null, set: (open) => set({ open }) }),
)

export type OpenMode = "new" | "same" | "overlay" | "copy"

/** Opens a link the way asked; unsafe links (javascript:, data:) are never opened. */
export function openLink(url: string, name: string, mode: OpenMode) {
  if (!isSafeHref(url)) return
  if (mode === "copy") {
    navigator.clipboard?.writeText(url).then(
      () => toast("Link copied", { description: url }),
      () => toast.error("Couldn't copy the link", { description: "The browser blocked clipboard access." }),
    )
    return
  }
  // Only web pages can be shown in the overlay; ssh://, smb:// and the like open normally.
  if (mode === "overlay" && /^https?:\/\//i.test(url)) return useOverlay.getState().set({ url, name })
  if (mode === "same") window.location.href = url
  else window.open(url, "_blank", "noopener,noreferrer")
}
