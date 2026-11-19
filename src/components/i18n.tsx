"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { formatDate, makeT, type Lang, type T } from "@/lib/i18n";

const Ctx = createContext<{ lang: Lang; tz: string }>({ lang: "de", tz: "UTC" });

export function LangProvider({ lang, tz, children }: { lang: Lang; tz: string; children: ReactNode }) {
  const v = useMemo(() => ({ lang, tz }), [lang, tz]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export const useLang = () => useContext(Ctx).lang;
export function useT(): T {
  const lang = useLang();
  return useMemo(() => makeT(lang), [lang]);
}
export function useDate() {
  const { lang, tz } = useContext(Ctx);
  return (ts: number, sec = false) => formatDate(ts, lang, sec, tz);
}
