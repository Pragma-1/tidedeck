"use client"

import { useEffect, useState } from "react"

/** Reads the theme straight from <html data-theme>, the same switch Tidewiki uses. */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const el = document.documentElement
    const read = () =>
      setDark(el.dataset.theme ? el.dataset.theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches)
    read()
    const mo = new MutationObserver(read)
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] })
    return () => mo.disconnect()
  }, [])
  return dark
}
