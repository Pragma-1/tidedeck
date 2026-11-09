"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/dashboard/fields"
import { useDashboard } from "@/hooks/use-dashboard"

export async function postAuth(body: Record<string, string>) {
  const res = await fetch("/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, error: (json.error as string) ?? `Server answered ${res.status}` }
}

export function PasswordForm({ mode, onDone }: { mode: "login" | "setup"; onDone: () => void }) {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === "setup" && password !== confirm) return setError("The two passwords don't match")
    setBusy(true)
    const r = await postAuth({ action: mode, password })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    onDone()
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Password" error={mode === "login" ? error : null} hint={mode === "setup" ? "At least 8 characters." : undefined}>
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete={mode === "setup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
            autoFocus
          />
        )}
      </Field>
      {mode === "setup" && (
        <Field label="Repeat password" error={error}>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value)
                setError(null)
              }}
            />
          )}
        </Field>
      )}
      <DialogFooter>
        <Button type="submit" disabled={busy || password.length === 0}>
          {mode === "setup" ? "Set password and edit" : "Sign in"}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function AuthDialog() {
  const mode = useDashboard((s) => s.authDialog)
  const setAuthDialog = useDashboard((s) => s.setAuthDialog)
  const setAuth = useDashboard((s) => s.setAuth)
  const requestEdit = useDashboard((s) => s.requestEdit)

  return (
    <Dialog open={!!mode} onOpenChange={(o) => !o && setAuthDialog(null)}>
      {mode && (
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{mode === "setup" ? "Protect your dashboard" : "Sign in to edit"}</DialogTitle>
            <DialogDescription>
              {mode === "setup"
                ? "Choose an admin password. Anyone can view the dashboard, but only you can change it."
                : "Enter the admin password to change this dashboard."}
            </DialogDescription>
          </DialogHeader>
          <PasswordForm
            mode={mode}
            onDone={() => {
              setAuth({ configured: true, authenticated: true, disabled: false })
              setAuthDialog(null)
              requestEdit(true)
            }}
          />
        </DialogContent>
      )}
    </Dialog>
  )
}
