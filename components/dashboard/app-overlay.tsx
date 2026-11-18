"use client"

import { ExternalLink, X } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Button } from "@/components/ui/button"
import { useOverlay } from "@/hooks/use-overlay"

/**
 * An app shown on top of the dashboard. Apps that forbid being embedded
 * (X-Frame-Options / frame-ancestors) stay blank: the hint says what to do.
 */
export function AppOverlay() {
  const open = useOverlay((s) => s.open)
  const set = useOverlay((s) => s.set)
  return (
    <DialogPrimitive.Root open={!!open} onOpenChange={(o) => !o && set(null)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="tide-corners fixed inset-2 z-50 flex flex-col overflow-hidden border bg-popover shadow-[var(--shadow)] outline-none sm:inset-6 lg:inset-x-[6vw] lg:inset-y-8 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]"
        >
          {open && (
            <>
              <div className="flex items-center gap-2 border-b py-1.5 pr-1.5 pl-4">
                <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {open.name || open.url}
                  <span className="ml-2 font-normal text-muted-foreground">{new URL(open.url).host}</span>
                </DialogPrimitive.Title>
                <Button variant="ghost" size="sm" asChild>
                  <a href={open.url} target="_blank" rel="noopener noreferrer" onClick={() => set(null)}>
                    <ExternalLink /> <span className="hidden sm:inline">New tab</span>
                  </a>
                </Button>
                <DialogPrimitive.Close asChild>
                  <Button variant="ghost" size="icon" aria-label="Close">
                    <X />
                  </Button>
                </DialogPrimitive.Close>
              </div>
              <iframe
                key={open.url}
                src={open.url}
                title={open.name || open.url}
                className="min-h-0 w-full flex-1 border-0 bg-background"
                // Same sandbox as the embed block: scripts and forms work, the dashboard itself can't be navigated.
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
                referrerPolicy="no-referrer"
                allow="fullscreen; clipboard-write"
              />
              <p className="border-t px-4 py-1.5 text-xs text-muted-foreground">
                Empty or &ldquo;refused to connect&rdquo;? {open.name || "This app"} doesn&apos;t allow being shown inside other pages. Use New tab instead.
              </p>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
