"use client"

import { useIsDark } from "@/hooks/use-is-dark"
import { Toaster as Sonner, type ToasterProps } from "sonner"

export function Toaster(props: ToasterProps) {
  const dark = useIsDark()
  return (
    <Sonner
      theme={dark ? "dark" : "light"}
      position="bottom-center"
      style={
        {
          "--normal-bg": "var(--band)",
          "--normal-text": "var(--band-ink)",
          "--normal-border": "var(--band-line)",
          "--border-radius": "0.7rem",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}
