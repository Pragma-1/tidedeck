"use client";
import { useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Trash2, X } from "lucide-react";
import { call } from "@/lib/client-api";
import { useDate, useT } from "./i18n";
import { useConfirm } from "./confirm";
import { useToast } from "./ui";

export type ManagedPage = {
  id: number;
  slug: string;
  title: string;
  parent_id: number | null;
  author: string | null;
  updated_at: number;
  /** may this person delete it (author or administrator) */
  mine: boolean;
};

type Row = ManagedPage & { depth: number; kids: number[] };

/** Pages in tree order with their depth; pages whose chapter is missing are shown at the top level. */
function flatten(pages: ManagedPage[]): Row[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const kids = new Map<number | null, ManagedPage[]>();
  for (const p of pages) {
    const parent = p.parent_id !== null && byId.has(p.parent_id) ? p.parent_id : null;
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent)!.push(p);
  }
  const out: Row[] = [];
  const seen = new Set<number>();
  const walk = (parent: number | null, depth: number) => {
    for (const p of kids.get(parent) ?? []) {
      if (seen.has(p.id)) continue; // never loop, whatever the data says
      seen.add(p.id);
      out.push({ ...p, depth, kids: (kids.get(p.id) ?? []).map((k) => k.id) });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function PageManager({ pages, isAdmin }: { pages: ManagedPage[]; isAdmin: boolean }) {
  const t = useT();
  const date = useDate();
  const router = useRouter();
  const toast = useToast();
  const [dialog, confirm] = useConfirm();
  const rows = useMemo(() => flatten(pages), [pages]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const last = useRef<number | null>(null);

  const descendants = (id: number): number[] => {
    const out: number[] = [];
    const stack = [...(byId.get(id)?.kids ?? [])];
    while (stack.length) {
      const k = stack.pop()!;
      out.push(k);
      stack.push(...(byId.get(k)?.kids ?? []));
    }
    return out;
  };

  // filter: matching pages, their chapters (for context) and their sub-pages (so a chapter's
  // selection never includes pages you can't see)
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    const keep = new Set<number>();
    for (const r of rows) {
      if (!r.title.toLowerCase().includes(q) && !r.slug.includes(q)) continue;
      keep.add(r.id);
      for (let p = r.parent_id; p !== null && byId.has(p) && !keep.has(p); p = byId.get(p)!.parent_id) keep.add(p);
      const stack = [...r.kids];
      while (stack.length) {
        const k = stack.pop()!;
        keep.add(k);
        stack.push(...(byId.get(k)?.kids ?? []));
      }
    }
    return rows.filter((r) => keep.has(r.id));
  }, [rows, filter, byId]);

  const selectable = visible.filter((r) => r.mine);
  const allOn = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const someOn = selectable.some((r) => selected.has(r.id));

  const toggle = (row: Row, index: number, e: MouseEvent<HTMLInputElement>) => {
    const on = !selected.has(row.id);
    const next = new Set(selected);
    const set = (id: number) => {
      if (!byId.get(id)?.mine) return;
      if (on) next.add(id);
      else next.delete(id);
    };
    if (e.shiftKey && last.current !== null && last.current !== index) {
      // shift-click: everything between the last click and this one
      const [a, b] = [Math.min(last.current, index), Math.max(last.current, index)];
      for (const r of visible.slice(a, b + 1)) set(r.id);
    } else {
      // a chapter takes its sub-pages along; they can be unticked one by one afterwards
      set(row.id);
      for (const d of descendants(row.id)) set(d);
    }
    last.current = index;
    setSelected(next);
  };

  const remove = async () => {
    const chosen = rows.filter((r) => selected.has(r.id));
    if (!chosen.length) return;
    const orphans = rows.filter((r) => !selected.has(r.id) && r.parent_id !== null && selected.has(r.parent_id)).length;
    const ok = await confirm({
      title: t("Move {n} pages to the trash?", { n: chosen.length }),
      body: (
        <>
          <ul className="plain-list pm-confirm-list">
            {chosen.slice(0, 8).map((r) => (
              <li key={r.id}>{r.title}</li>
            ))}
            {chosen.length > 8 && <li className="hint">{t("… and {n} more", { n: chosen.length - 8 })}</li>}
          </ul>
          <p>
            {t("They stay in the trash with their whole history for 30 days and can be restored from there.")}
            {orphans > 0 && " " + t("{n} sub-pages that aren’t selected move to the top level.", { n: orphans })}
          </p>
        </>
      ),
      confirmLabel: t("Move to trash"),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const r = await call<{ trashed: number; missing: number }>("/api/pages", "DELETE", {
      slugs: chosen.map((c) => c.slug),
    });
    setBusy(false);
    if (!r.ok) {
      toast.show({ ok: false, text: t(r.data.error ?? "Couldn’t delete.") });
      return;
    }
    setSelected(new Set());
    last.current = null;
    toast.show({
      ok: true,
      text:
        t("{n} pages moved to the trash.", { n: r.data.trashed }) +
        (r.data.missing ? " " + t("{n} were already gone.", { n: r.data.missing }) : ""),
    });
    router.refresh();
  };

  const count = selected.size;
  return (
    <>
      {dialog}
      {toast.node}
      <div className="pm-bar" role="toolbar" aria-label={t("Selection")}>
        <div className="pm-search">
          <Search size={16} aria-hidden />
          <input
            className="input"
            type="search"
            value={filter}
            placeholder={t("Filter pages")}
            aria-label={t("Filter pages")}
            onChange={(e) => {
              setFilter(e.target.value);
              last.current = null;
            }}
          />
        </div>
        <span className="pm-count" aria-live="polite">
          {count ? t("{n} selected", { n: count }) : t("Nothing selected")}
        </span>
        {count > 0 && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              setSelected(new Set());
              last.current = null;
            }}
          >
            <X size={15} aria-hidden />
            {t("Clear selection")}
          </button>
        )}
        <button type="button" className="btn danger sm" disabled={!count || busy} onClick={() => void remove()}>
          <Trash2 size={15} aria-hidden />
          {busy ? t("Deleting…") : t("Delete selected")}
        </button>
      </div>
      <div className="table-wrap">
        <table className="data pm-table">
          <thead>
            <tr>
              <th className="pm-check">
                <input
                  type="checkbox"
                  aria-label={t("Select all shown pages")}
                  checked={allOn}
                  ref={(el) => {
                    if (el) el.indeterminate = someOn && !allOn;
                  }}
                  disabled={!selectable.length}
                  onChange={() => {
                    const next = new Set(selected);
                    for (const r of selectable) {
                      if (allOn) next.delete(r.id);
                      else next.add(r.id);
                    }
                    last.current = null;
                    setSelected(next);
                  }}
                />
              </th>
              <th>{t("Page")}</th>
              <th className="pm-hide-sm">{t("Created by")}</th>
              <th className="pm-hide-sm right">{t("Last change")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={r.id} className={selected.has(r.id) ? "pm-on" : undefined}>
                <td className="pm-check">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    disabled={!r.mine || busy}
                    title={r.mine ? undefined : t("Only the author or an administrator can delete this page.")}
                    aria-label={t("Select “{title}”", { title: r.title })}
                    onClick={(e) => toggle(r, i, e)}
                    onChange={() => {
                      /* handled in onClick (needs the shift key) */
                    }}
                  />
                </td>
                <td>
                  <div className="pm-title" style={{ paddingLeft: `${r.depth * 1.3}rem` }}>
                    <Link href={`/w/${r.slug}`}>{r.title}</Link>
                    {r.kids.length > 0 && (
                      <span className="badge" title={t("{n} sub-pages", { n: r.kids.length })}>
                        {r.kids.length}
                      </span>
                    )}
                  </div>
                  <div className="meta mono" style={{ paddingLeft: `${r.depth * 1.3}rem` }}>
                    /w/{r.slug}
                  </div>
                </td>
                <td className="pm-hide-sm">{r.author ?? <span className="hint">—</span>}</td>
                <td className="pm-hide-sm right nowrap">{date(r.updated_at)}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="hint" style={{ textAlign: "center", padding: "2rem" }}>
                  {rows.length ? t("No page matches the filter.") : t("No pages yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!isAdmin && (
        <p className="hint">{t("You can delete the pages you created; administrators can delete any page.")}</p>
      )}
      <p className="hint">{t("Tip: Shift-click selects a range. Ticking a chapter ticks its sub-pages too.")}</p>
    </>
  );
}
