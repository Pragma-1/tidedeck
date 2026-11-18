"use client"

import { LayoutDashboard, Lock } from "lucide-react"
import { PasswordForm } from "@/components/dashboard/auth-dialog"

/** Shown instead of the dashboard when "Require sign-in to view" is on. */
export function Locked({ title }: { title: string }) {
  return (
    <>
      <header className="band">
        <div className="mx-auto flex max-w-[var(--page-max,105rem)] items-center gap-2.5 px-4 pt-3.5 pb-16 sm:px-6 lg:px-10">
          <LayoutDashboard className="size-[22px] opacity-85" aria-hidden />
          <span className="text-xl font-[650] tracking-[-0.01em]">{title}</span>
        </div>
      </header>
      <main className="relative -mt-10 grid place-items-center px-4 pb-16">
        <div className="block-surface w-full max-w-sm rounded-[1.6rem_0.4rem_1rem_1rem] p-6">
          <Lock className="mb-4 size-6 text-primary" aria-hidden />
          <h1 className="text-2xl font-bold tracking-[-0.02em]">Sign in</h1>
          <p className="mt-1 mb-5 text-sm text-muted-foreground">This dashboard is only visible to signed-in users.</p>
          <PasswordForm mode="login" onDone={() => window.location.reload()} />
        </div>
      </main>
    </>
  )
}
