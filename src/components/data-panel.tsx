"use client";
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  CornerDownRight,
  CornerUpLeft,
  Download,
  FileArchive,
  FolderInput,
  Lock,
  RotateCcw,
  Upload,
} from "lucide-react";
import { call } from "@/lib/client-api";
import { Actions, Notice } from "./ui";
import { useT } from "./i18n";
import { useConfirm } from "./confirm";

type Action = "create" | "overwrite" | "skip" | "copy";
type PlanItem = {
  key: string;
  path: string;
  title: string;
  slug: string;
  parent: string | null;
  parentKey: string | null;
  parentPage: number | null;
  action: Action;
  exists: boolean;
  existingDepth: number | null;
};
type Result = {
  pages: PlanItem[];
  media: number;
  mediaReused: number;
  warnings: string[];
  created: number;
  updated: number;
  skipped: number;
  excluded: number;
  token?: string;
};
export type ExistingPage = { id: number; title: string; depth: number };

/** "" = top level, "page:<id>" = under an existing wiki page, otherwise the key of an imported page. */
type Bucket = string;
type Arrangement = {
  kids: Record<Bucket, string[]>;
  parent: Record<string, Bucket>;
  include: Record<string, boolean>;
  title: Record<string, string>;
};

function initial(pages: PlanItem[]): Arrangement {
  const a: Arrangement = { kids: { "": [] }, parent: {}, include: {}, title: {} };
  for (const p of pages) {
    const b = p.parentKey ?? (p.parentPage ? `page:${p.parentPage}` : "");
    (a.kids[b] ??= []).push(p.key);
    a.parent[p.key] = b;
    a.include[p.key] = true;
    a.title[p.key] = p.title;
  }
  return a;
}

const copy = (a: Arrangement): Arrangement => ({
  kids: Object.fromEntries(Object.entries(a.kids).map(([k, v]) => [k, [...v]])),
  parent: { ...a.parent },
  include: { ...a.include },
  title: { ...a.title },
});

export function DataPanel({ pages: existingPages, maxDepth }: { pages: ExistingPage[]; maxDepth: number }) {
  const t = useT();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [conflict, setConflict] = useState<"skip" | "overwrite" | "copy">("skip");
  const [plan, setPlan] = useState<Result | null>(null);
  const [arr, setArr] = useState<Arrangement | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, confirm] = useConfirm();
  const moveTo = useRef<string>("");

  const items = useMemo(() => new Map((plan?.pages ?? []).map((p) => [p.key, p])), [plan]);
  const pageInfo = useMemo(() => new Map(existingPages.map((p) => [p.id, p])), [existingPages]);

  const preview = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/import?mode=preview&conflict=${conflict}&name=${encodeURIComponent(file.name.slice(0, 120))}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/octet-stream" },
          body: file,
        },
      );
      const d = (await res.json().catch(() => ({}))) as Result & { error?: string };
      if (!res.ok) {
        setError(t(d.error ?? "Something went wrong."));
        return;
      }
      setPlan(d);
      setArr(initial(d.pages));
      setDone(null);
    } catch {
      setError(t("Can’t reach the server. Check your connection."));
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------ tree logic */

  // an existing page with the same address that is kept ("skip") stays where it is in the wiki
  const fixed = (k: string) => conflict === "skip" && !!items.get(k)?.exists;
  const actionOf = (k: string): Action => {
    const p = items.get(k);
    if (!p?.exists) return "create";
    return conflict === "overwrite" ? "overwrite" : conflict === "copy" ? "copy" : "skip";
  };
  const bucketDepth = (a: Arrangement, b: Bucket): number =>
    b === "" ? 0 : b.startsWith("page:") ? (pageInfo.get(Number(b.slice(5)))?.depth ?? 1) : depthOf(a, b);
  const depthOf = (a: Arrangement, k: string, guard = 0): number =>
    guard > 60
      ? 99
      : fixed(k)
        ? (items.get(k)?.existingDepth ?? 1)
        : (a.parent[k] === "" || a.parent[k].startsWith("page:")
            ? bucketDepth(a, a.parent[k])
            : depthOf(a, a.parent[k], guard + 1)) + 1;
  /** levels of sub-pages that move along with `k` (kept pages stay put, so they don't count) */
  const heightOf = (a: Arrangement, k: string): number =>
    Math.max(0, ...(a.kids[k] ?? []).map((c) => (fixed(c) ? 0 : 1 + heightOf(a, c))));
  const fits = (a: Arrangement, k: string, target: Bucket) => bucketDepth(a, target) + 1 + heightOf(a, k) <= maxDepth;
  const isInside = (a: Arrangement, k: string, maybeAncestor: string) => {
    for (let b = a.parent[maybeAncestor], i = 0; b !== undefined && b !== "" && !b.startsWith("page:") && i < 60; i++) {
      if (b === k) return true;
      b = a.parent[b];
    }
    return maybeAncestor === k;
  };
  const put = (a: Arrangement, k: string, target: Bucket, at?: number) => {
    const from = a.kids[a.parent[k]];
    from.splice(from.indexOf(k), 1);
    const list = (a.kids[target] ??= []);
    list.splice(at ?? list.length, 0, k);
    a.parent[k] = target;
  };

  const edit = (fn: (a: Arrangement) => void) =>
    setArr((cur) => {
      if (!cur) return cur;
      const a = copy(cur);
      fn(a);
      return a;
    });

  const up = (k: string) =>
    edit((a) => {
      const l = a.kids[a.parent[k]];
      const i = l.indexOf(k);
      if (i > 0) [l[i - 1], l[i]] = [l[i], l[i - 1]];
    });
  const down = (k: string) =>
    edit((a) => {
      const l = a.kids[a.parent[k]];
      const i = l.indexOf(k);
      if (i >= 0 && i < l.length - 1) [l[i + 1], l[i]] = [l[i], l[i + 1]];
    });
  /** one level up: right after its current chapter (a main page when it was directly under one) */
  const canOutdent = (a: Arrangement, k: string) => a.parent[k] !== "";
  const outdent = (k: string) =>
    edit((a) => {
      const p = a.parent[k];
      if (p === "") return;
      if (p.startsWith("page:")) return put(a, k, "");
      const gp = a.parent[p];
      put(a, k, gp, a.kids[gp].indexOf(p) + 1);
    });
  /** one level down: a sub-page of the page above it */
  const prevSibling = (a: Arrangement, k: string) => {
    const l = a.kids[a.parent[k]];
    const i = l.indexOf(k);
    return i > 0 ? l[i - 1] : null;
  };
  const canIndent = (a: Arrangement, k: string) => {
    const s = prevSibling(a, k);
    return s !== null && fits(a, k, s);
  };
  const indent = (k: string) =>
    edit((a) => {
      const s = prevSibling(a, k);
      if (s !== null && fits(a, k, s)) put(a, k, s);
    });

  const pickParent = async (k: string) => {
    if (!arr) return;
    const options: { value: string; label: string }[] = [{ value: "", label: t("Top level (main page)") }];
    const walk = (b: Bucket, depth: number) => {
      for (const c of arr.kids[b] ?? []) {
        if (c !== k && !isInside(arr, k, c) && fits(arr, k, c))
          options.push({ value: c, label: `${" ".repeat(depth)}${arr.title[c] || items.get(c)?.title}` });
        walk(c, depth + 1);
      }
    };
    walk("", 0);
    for (const b of Object.keys(arr.kids)) if (b.startsWith("page:")) walk(b, 1);
    const existing = existingPages
      .filter((p) => fits(arr, k, `page:${p.id}`))
      .map((p) => ({ value: `page:${p.id}`, label: `${" ".repeat(p.depth - 1)}${p.title}` }));
    moveTo.current = arr.parent[k];
    const ok = await confirm({
      title: t("Move “{title}”", { title: arr.title[k] || items.get(k)?.title || "" }),
      body: (
        <div className="field">
          <label htmlFor="imp-move">{t("New chapter")}</label>
          <select
            id="imp-move"
            className="input"
            defaultValue={arr.parent[k]}
            onChange={(e) => (moveTo.current = e.target.value)}
          >
            <optgroup label={t("From this import")}>
              {options.map((o) => (
                <option key={o.value || "top"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
            {existing.length > 0 && (
              <optgroup label={t("Existing pages in the wiki")}>
                {existing.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <p className="hint">{t("Sub-pages move along. Only chapters with room for them are listed.")}</p>
        </div>
      ),
      confirmLabel: t("Move"),
    });
    const target = moveTo.current;
    if (!ok || target === arr.parent[k]) return;
    edit((a) => {
      if (target !== k && !isInside(a, k, target) && fits(a, k, target)) put(a, k, target);
    });
  };

  /** Every page exactly once, depth-first, in the arranged order — what the server expects. */
  const layout = (a: Arrangement) => {
    const out: { key: string; parent: string | null; title?: string; include: boolean }[] = [];
    const seen = new Set<string>();
    const walk = (b: Bucket) => {
      for (const k of a.kids[b] ?? []) {
        if (seen.has(k)) continue;
        seen.add(k);
        const changed = a.title[k].trim() && a.title[k] !== items.get(k)?.title;
        out.push({
          key: k,
          parent: b === "" ? null : b,
          include: a.include[k],
          ...(changed ? { title: a.title[k] } : {}),
        });
        walk(k);
      }
    };
    walk("");
    for (const b of Object.keys(a.kids)) if (b.startsWith("page:")) walk(b);
    return out;
  };

  const apply = async () => {
    if (!plan?.token || !arr) return;
    setBusy(true);
    setError(null);
    const r = await call<Result>("/api/import/apply", "POST", { token: plan.token, conflict, layout: layout(arr) });
    setBusy(false);
    if (!r.ok) {
      setError(t(r.data.error ?? "Something went wrong."));
      if (r.status === 410) {
        setPlan(null);
        setArr(null);
      }
      return;
    }
    setDone(r.data);
    setPlan(null);
    setArr(null);
    setFile(null);
    if (input.current) input.current.value = "";
    router.refresh();
  };

  /* ------------------------------------------------------------- rendering */

  const ACTION: Record<Action, string> = {
    create: t("new"),
    overwrite: t("new version"),
    skip: t("kept as it is"),
    copy: t("copy"),
  };
  const tooDeep = arr ? [...items.keys()].filter((k) => arr.include[k] && depthOf(arr, k) > maxDepth) : [];
  const included = arr ? [...items.keys()].filter((k) => arr.include[k]).length : 0;

  const renderRows = (a: Arrangement, b: Bucket, level: number): ReactNode[] =>
    (a.kids[b] ?? []).flatMap((k) => {
      const p = items.get(k)!;
      const l = a.kids[b];
      const i = l.indexOf(k);
      const isFixed = fixed(k);
      const off = !a.include[k];
      const deep = a.include[k] && depthOf(a, k) > maxDepth;
      const name = a.title[k] || p.title;
      return [
        <li
          key={k}
          className={`imp-row${off ? " off" : ""}${deep ? " deep" : ""}`}
          style={{ "--lvl": level } as CSSProperties}
        >
          <input
            type="checkbox"
            checked={a.include[k]}
            aria-label={t("Import “{title}”", { title: name })}
            onChange={(e) => edit((x) => (x.include[k] = e.target.checked))}
          />
          <div className="imp-main">
            <input
              className="input imp-title"
              value={a.title[k]}
              placeholder={p.title}
              maxLength={120}
              disabled={isFixed || off}
              aria-label={t("Title of {path}", { path: p.path })}
              onChange={(e) => edit((x) => (x.title[k] = e.target.value))}
            />
            <div className="meta mono imp-path">
              {p.path}
              {off && a.kids[k]?.length ? ` · ${t("left out — its sub-pages move up a level")}` : ""}
              {deep ? ` · ${t("nested too deeply")}` : ""}
            </div>
          </div>
          <span className={`badge${actionOf(k) === "overwrite" ? " warn" : ""}`}>
            {off ? t("left out") : ACTION[actionOf(k)]}
          </span>
          <div className="imp-btns" role="group" aria-label={t("Arrange “{title}”", { title: name })}>
            {isFixed ? (
              <span className="hint imp-fixed" title={t("The existing page is kept and stays where it is.")}>
                <Lock size={14} aria-hidden /> {t("stays")}
              </span>
            ) : (
              <>
                <button
                  type="button"
                  className="icon-btn plain"
                  disabled={i === 0}
                  onClick={() => up(k)}
                  title={t("Up")}
                >
                  <ArrowUp size={16} aria-hidden />
                  <span className="sr-only">{t("Up")}</span>
                </button>
                <button
                  type="button"
                  className="icon-btn plain"
                  disabled={i === l.length - 1}
                  onClick={() => down(k)}
                  title={t("Down")}
                >
                  <ArrowDown size={16} aria-hidden />
                  <span className="sr-only">{t("Down")}</span>
                </button>
                <button
                  type="button"
                  className="icon-btn plain"
                  disabled={!canOutdent(a, k)}
                  onClick={() => outdent(k)}
                  title={t("One level up (main page)")}
                >
                  <CornerUpLeft size={16} aria-hidden />
                  <span className="sr-only">{t("One level up (main page)")}</span>
                </button>
                <button
                  type="button"
                  className="icon-btn plain"
                  disabled={!canIndent(a, k)}
                  onClick={() => indent(k)}
                  title={t("Sub-page of the page above")}
                >
                  <CornerDownRight size={16} aria-hidden />
                  <span className="sr-only">{t("Sub-page of the page above")}</span>
                </button>
                <button
                  type="button"
                  className="icon-btn plain"
                  onClick={() => void pickParent(k)}
                  title={t("Move to another chapter")}
                >
                  <FolderInput size={16} aria-hidden />
                  <span className="sr-only">{t("Move to another chapter")}</span>
                </button>
              </>
            )}
          </div>
        </li>,
        ...renderRows(a, k, level + 1),
      ];
    });

  return (
    <div className="settings-grid">
      {dialog}
      <section className="panel">
        <h2 className="section-title">
          <Download size={18} aria-hidden /> {t("Export")}
        </h2>
        <p>
          {t(
            "Download the whole wiki as a ZIP: every page as a Markdown file (with its title in the front matter), chapters as folders, and all uploaded files in _media/. The archive can be imported here again or opened with any Markdown tool.",
          )}
        </p>
        <p className="hint">{t("Single pages can be downloaded as .md from the page itself.")}</p>
        <Actions>
          <a className="btn" href="/api/export" download>
            <FileArchive size={16} aria-hidden />
            {t("Export wiki (.zip)")}
          </a>
        </Actions>
      </section>
      <section className="panel">
        <h2 className="section-title">
          <Upload size={18} aria-hidden /> {t("Import")}
        </h2>
        <p>
          {t(
            "Import a ZIP export, any ZIP with a folder of Markdown files, or a single .md file. Folders become chapters; the title comes from the front matter, the first heading or the file name.",
          )}
        </p>
        {error && <Notice kind="error">{error}</Notice>}
        {done && (
          <Notice>
            {t("Import finished: {c} created, {u} updated, {s} skipped, {m} files.", {
              c: done.created,
              u: done.updated,
              s: done.skipped,
              m: done.media,
            })}
          </Notice>
        )}
        <div className="field">
          <label htmlFor="imp-file">{t("File")}</label>
          <input
            id="imp-file"
            ref={input}
            className="input"
            type="file"
            accept=".zip,.md,.markdown,application/zip,text/markdown"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPlan(null);
              setArr(null);
              setDone(null);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="imp-conflict">{t("If a page with the same address exists")}</label>
          <select
            id="imp-conflict"
            className="input"
            value={conflict}
            onChange={(e) => setConflict(e.target.value as typeof conflict)}
          >
            <option value="skip">{t("Keep the existing page (skip)")}</option>
            <option value="overwrite">{t("Save the imported text as a new version")}</option>
            <option value="copy">{t("Import as an additional page")}</option>
          </select>
        </div>
        <Actions>
          <button type="button" className="btn ghost" disabled={!file || busy} onClick={() => void preview()}>
            {busy && !plan ? t("Checking…") : t("Preview and arrange")}
          </button>
        </Actions>
      </section>
      {plan && arr && (
        <section className="panel" style={{ gridColumn: "1 / -1" }}>
          <div className="row between">
            <h2 className="section-title" style={{ margin: 0 }}>
              {t("Arrange the import")}
            </h2>
            <button type="button" className="btn ghost sm" onClick={() => setArr(initial(plan.pages))}>
              <RotateCcw size={15} aria-hidden />
              {t("Reset")}
            </button>
          </div>
          <p className="hint">
            {t("{n} pages, {m} files. Nothing has been changed yet.", { n: plan.pages.length, m: plan.media })}{" "}
            {t(
              "Change the order, make pages main pages or sub-pages, move them under an existing page, rename them or leave them out. Chapters can be nested {n} levels deep.",
              { n: maxDepth },
            )}
          </p>
          {plan.warnings.length > 0 && (
            <Notice kind="error">
              <strong>{t("Notes")}:</strong>
              <ul className="plain-list">
                {plan.warnings.slice(0, 50).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Notice>
          )}
          <ol className="imp-tree" aria-label={t("Pages of the import")}>
            {renderRows(arr, "", 0)}
            {Object.keys(arr.kids)
              .filter((b) => b.startsWith("page:") && arr.kids[b].length)
              .flatMap((b) => [
                <li key={b} className="imp-anchor">
                  <FolderInput size={15} aria-hidden />
                  {t("Under the existing page “{title}”", {
                    title: pageInfo.get(Number(b.slice(5)))?.title ?? "?",
                  })}
                </li>,
                ...renderRows(arr, b, 1),
              ])}
          </ol>
          {tooDeep.length > 0 && (
            <Notice kind="error">
              {t("{n} pages are nested deeper than {max} levels. Move them up before importing.", {
                n: tooDeep.length,
                max: maxDepth,
              })}
            </Notice>
          )}
          <Actions>
            <button
              type="button"
              className="btn"
              disabled={busy || included === 0 || tooDeep.length > 0}
              onClick={() => void apply()}
            >
              {busy ? t("Importing…") : t("Import {n} pages now", { n: included })}
            </button>
          </Actions>
        </section>
      )}
    </div>
  );
}
