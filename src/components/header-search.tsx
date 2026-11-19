"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CornerDownLeft, FileText, Search } from "lucide-react";
import type { Segment } from "@/lib/search";
import { Segments } from "./segments";
import { useT } from "./i18n";

type Hit = { slug: string; title: Segment[]; snippet: Segment[] };
const MAX = 200;

/**
 * Header search: matches appear while typing; Enter shows every matching page on /search,
 * ↑/↓ + Enter opens one directly. Ctrl/⌘+K or "/" focuses it from anywhere.
 * Works as a plain GET form without JavaScript.
 */
export function HeaderSearch() {
  const t = useT();
  const router = useRouter();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLFormElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [sel, setSel] = useState(-1);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current && !box.current.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, []);

  useEffect(() => {
    if (!q.trim()) {
      setHits(null);
      setTotal(0);
      setBusy(false);
      return;
    }
    const ctl = new AbortController();
    setBusy(true);
    const h = setTimeout(
      () =>
        void (async () => {
          try {
            const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
              credentials: "same-origin",
              signal: ctl.signal,
            });
            if (r.ok) {
              const j = (await r.json()) as { hits: Hit[]; total: number };
              setHits(Array.isArray(j.hits) ? j.hits : []);
              setTotal(Number(j.total) || 0);
              setSel(-1);
            }
          } catch {
            /* aborted or offline */
          } finally {
            if (!ctl.signal.aborted) setBusy(false);
          }
        })(),
      180,
    );
    return () => {
      clearTimeout(h);
      ctl.abort();
    };
  }, [q]);

  // The list lives in a portal on <body> (the header clips its own overflow for the contour pattern),
  // positioned under the search box and kept there on scroll and resize.
  const expandedNow = open && q.trim().length > 0;
  useLayoutEffect(() => {
    if (!expandedNow) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = input.current?.getBoundingClientRect();
      if (!r) return;
      const vw = document.documentElement.clientWidth;
      const width = Math.min(Math.max(r.width, 480), vw - 32);
      const left = Math.min(Math.max(16, r.left), vw - 16 - width);
      setPos({ position: "fixed", top: r.bottom + 8, left, width });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
    };
  }, [expandedNow]);

  const go = (href: string) => {
    setOpen(false);
    input.current?.blur();
    router.push(href);
  };
  const showAll = () => {
    if (q.trim()) go(`/search?q=${encodeURIComponent(q)}`);
  };
  const list = hits ?? [];
  const expanded = open && q.trim().length > 0;

  return (
    <form
      ref={box}
      className="top-search"
      role="search"
      action="/search"
      method="get"
      onSubmit={(e) => {
        e.preventDefault();
        if (sel >= 0 && list[sel]) go(`/w/${list[sel].slug}`);
        else showAll();
      }}
    >
      <Search size={16} aria-hidden />
      <label className="sr-only" htmlFor={`${id}-q`}>
        {t("Search the wiki")}
      </label>
      <input
        ref={input}
        id={`${id}-q`}
        name="q"
        type="search"
        placeholder={t("Search pages")}
        maxLength={MAX}
        autoComplete="off"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={expanded && sel >= 0 ? `${id}-o${sel}` : undefined}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setSel((s) => Math.min(s + 1, list.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(s - 1, -1));
          } else if (e.key === "Escape") {
            if (open) {
              e.preventDefault();
              setOpen(false);
              setSel(-1);
            } else input.current?.blur();
          }
        }}
      />
      <kbd className="qs-hint" aria-hidden>
        Ctrl K
      </kbd>
      {expanded &&
        pos &&
        createPortal(
          <div className="hs-pop" ref={pop} style={pos}>
            <ul id={`${id}-list`} role="listbox" className="qs-list" aria-label={t("Matches")}>
              {list.map((h, i) => (
                <li
                  key={h.slug}
                  id={`${id}-o${i}`}
                  role="option"
                  aria-selected={i === sel}
                  onMouseEnter={() => setSel(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(`/w/${h.slug}`)}
                >
                  <FileText size={16} aria-hidden />
                  <span>
                    <strong>
                      <Segments segs={h.title} />
                    </strong>
                    <span className="hint">
                      <Segments segs={h.snippet} />
                    </span>
                  </span>
                </li>
              ))}
              {hits !== null && list.length === 0 && !busy && (
                <li className="hint qs-empty" aria-disabled="true">
                  {t("No page matches “{q}”.", { q })}
                </li>
              )}
              {hits === null && busy && (
                <li className="hint qs-empty" aria-disabled="true">
                  {t("Searching …")}
                </li>
              )}
            </ul>
            <button type="button" className="hs-all" onMouseDown={(e) => e.preventDefault()} onClick={showAll}>
              <CornerDownLeft size={15} aria-hidden />
              {total > list.length ? t("Show all {n} matches", { n: total }) : t("Show results page")}
            </button>
          </div>,
          document.body,
        )}
    </form>
  );
}
