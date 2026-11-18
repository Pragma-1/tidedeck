"use client"

import { createContext, useContext, useEffect, useState } from "react"
import type { LocaleContext } from "@/lib/locale-context"

/** The browser's locale and time zone as the server saw them (null on a first visit). */
export const LocaleCtx = createContext<LocaleContext | null>(null)
export const useLocaleContext = () => useContext(LocaleCtx)

/**
 * The locale to format or sort with: while the page hydrates, the one the server
 * rendered with (the cookie's, else `fallback`), so both produce the same HTML;
 * after that the browser's own (undefined = browser default).
 */
export function useHydrationLocale(fallback?: string): string | undefined {
  const seen = useLocaleContext()
  const [live, setLive] = useState(false)
  useEffect(() => setLive(true), [])
  return live ? undefined : (seen?.locale ?? fallback)
}
