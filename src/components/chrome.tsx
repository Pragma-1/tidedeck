"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, Moon, RefreshCw, Sun, X, LogOut } from "lucide-react";
import { call } from "@/lib/client-api";
import { useT } from "./i18n";
import { msg } from "@/lib/msg";

/** Hamburger in the header (narrow screens only); opens the page drawer. */
export function MenuButton() {
  const t = useT();
  return (
    <button
      type="button"
      className="icon-btn menu-btn"
      aria-controls="rail"
      aria-label={t("Open navigation")}
      title={t("Pages")}
      onClick={() => window.dispatchEvent(new Event("tidewiki:nav"))}
    >
      <Menu size={22} aria-hidden />
    </button>
  );
}

export function NavDrawer({ children }: { children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const o = () => setOpen(true);
    window.addEventListener("tidewiki:nav", o);
    return () => window.removeEventListener("tidewiki:nav", o);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="rail-wrap" data-open={open}>
      <button
        type="button"
        className="rail-backdrop"
        aria-label={t("Close navigation")}
        onClick={() => setOpen(false)}
        tabIndex={-1}
      />
      <div id="rail" className="rail" role="navigation" aria-label={t("Pages")}>
        <button
          type="button"
          className="icon-btn menu-btn rail-close"
          onClick={() => setOpen(false)}
          aria-label={t("Close navigation")}
        >
          <X size={20} aria-hidden />
        </button>
        {children}
      </div>
    </div>
  );
}

const setCookie = (k: string, v: string) => {
  document.cookie = `${k}=${v}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
};

export function ThemeToggle() {
  const t = useT();
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const th = document.documentElement.dataset.theme;
    setDark(th ? th === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setCookie("theme", next);
    setDark(!dark);
  };
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={toggle}
      aria-label={dark ? t("Switch to light theme") : t("Switch to dark theme")}
      title={dark ? t("Switch to light theme") : t("Switch to dark theme")}
    >
      {dark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
}

export function LogoutButton() {
  const t = useT();
  const router = useRouter();
  return (
    <button
      type="button"
      className="top-link"
      onClick={async () => {
        await call("/api/auth/logout", "POST");
        router.push("/");
        router.refresh();
      }}
    >
      <LogOut size={18} aria-hidden />
      <span>{t("Sign out")}</span>
    </button>
  );
}

type WikiEvent = { type: "page.created" | "page.updated" | "page.deleted"; slug: string; title?: string; rev?: number };

/** Subscribes to server-sent events so every open page reflects edits as they happen. */
export function LiveUpdates({ slug, rev, editing = false }: { slug?: string; rev?: number; editing?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("wiki", (m) => {
      let e: WikiEvent;
      try {
        e = JSON.parse((m as MessageEvent<string>).data);
      } catch {
        return;
      }
      const mine = !!slug && e.slug === slug;
      if (mine && e.type === "page.deleted") {
        router.push("/");
        router.refresh();
        return;
      }
      if (mine && e.type === "page.updated" && e.rev !== undefined && rev !== undefined && e.rev <= rev) return;
      if (editing && mine) {
        setNote(msg("Someone else just saved this page. Your changes are kept here — saving will ask you to merge."));
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 150);
      if (mine) {
        setNote(msg("This page was just updated."));
        setTimeout(() => setNote(null), 4000);
      }
    });
    return () => {
      es.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [slug, rev, editing, router]);
  if (!note) return null;
  return (
    <div className="toast" role="status">
      <RefreshCw size={16} aria-hidden />
      <span>{t(note)}</span>
      <button type="button" onClick={() => setNote(null)}>
        {t("Dismiss")}
      </button>
    </div>
  );
}
