"use client"

import { Lock } from "lucide-react"
import { PasswordForm } from "@/components/dashboard/auth-dialog"

/** Shown instead of the dashboard when "Require sign-in to view" is on. */
export function Locked({ title }: { title: string }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="block-surface w-full max-w-sm rounded-xl p-6">
        <Lock className="mb-4 size-6 text-primary" aria-hidden />
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 mb-5 text-sm text-muted-foreground">Sign in to see this dashboard.</p>
        <PasswordForm mode="login" onDone={() => window.location.reload()} />
      </div>
    </main>
  )
}
