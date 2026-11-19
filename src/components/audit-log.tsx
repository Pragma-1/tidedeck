"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Download, FilterX, RefreshCw, Search } from "lucide-react";
import { CATEGORIES, EVENT_LABELS, eventId, type AuditRow, type Category } from "@/lib/audit-shared";
import { useDate, useT } from "./i18n";

type Filters = { q: string; category: "" | Category; user: string; from: string; to: string };
const EMPTY: Filters = { q: "", category: "", user: "", from: "", to: "" };

/** Local calendar day → unix seconds (the `to` day is inclusive). */
const dayStart = (d: string) => Math.floor(new Date(`${d}T00:00:00`).getTime() / 1000);

function toQuery(f: Filters, extra: Record<string, string | number> = {}) {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.category) p.set("category", f.category);
  if (f.user) p.set("user", f.user);
  if (f.from) p.set("from", String(dayStart(f.from)));
  if (f.to) p.set("to", String(dayStart(f.to) + 86400));
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p.toString();
}

const FAILURE = /failed|blocked|locked|bad_token/;

export function AuditLog({
  initial,
  users,
}: {
  initial: { rows: AuditRow[]; total: number };
  users: { id: number; username: string }[];
}) {
  const t = useT();
  const date = useDate();
  const [f, setF] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState(initial.rows);
  const [total, setTotal] = useState(initial.total);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const first = useRef(true);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (filters: Filters, before?: number) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/audit?${toQuery(filters, { limit: 50, ...(before ? { before } : {}) })}`, {
          credentials: "same-origin",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setRows((cur) => (before ? [...cur, ...data.rows] : data.rows));
        setTotal(data.total);
        if (!before) box.current?.scrollTo({ top: 0 });
      } catch (e) {
        setError(e instanceof Error && e.message ? e.message : t("Couldn’t load the log."));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  // Debounced reload whenever a filter changes (the first render already has server data).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const h = setTimeout(() => void load(f), 250);
    return () => clearTimeout(h);
  }, [f, load]);

  const more = rows.length < total;
  const onScroll = () => {
    const el = box.current;
    if (el && more && !busy && el.scrollTop + el.clientHeight > el.scrollHeight - 120)
      void load(f, rows[rows.length - 1]?.id);
  };
  const set = (k: keyof Filters) => (v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const copy = async (id: number) => {
    await navigator.clipboard?.writeText(eventId(id));
    setCopied(id);
    setTimeout(() => setCopied(null), 1200);
  };
  const exportHref = (format: "csv" | "json") => `/api/audit/export?${toQuery(f, { format })}`;

  return (
    <section className="audit">
      <div className="audit-tools" role="search">
        <div className="audit-search">
          <Search size={16} aria-hidden />
          <input
            className="input"
            type="search"
            placeholder={t("Search ID, event, user, IP or details")}
            aria-label={t("Search the security log")}
            value={f.q}
            onChange={(e) => set("q")(e.target.value)}
            maxLength={100}
          />
        </div>
        <label className="sr-only" htmlFor="al-cat">
          {t("Category")}
        </label>
        <select id="al-cat" className="input" value={f.category} onChange={(e) => set("category")(e.target.value)}>
          <option value="">{t("All categories")}</option>
          {(Object.keys(CATEGORIES) as Category[]).map((c) => (
            <option key={c} value={c}>
              {t(CATEGORIES[c].label)}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="al-user">
          {t("User")}
        </label>
        <select id="al-user" className="input" value={f.user} onChange={(e) => set("user")(e.target.value)}>
          <option value="">{t("All users")}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.username}
            </option>
          ))}
        </select>
        <label className="date-field">
          <span>{t("From")}</span>
          <input
            className="input"
            type="date"
            value={f.from}
            max={f.to || undefined}
            onChange={(e) => set("from")(e.target.value)}
          />
        </label>
        <label className="date-field">
          <span>{t("To")}</span>
          <input
            className="input"
            type="date"
            value={f.to}
            min={f.from || undefined}
            onChange={(e) => set("to")(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => setF(EMPTY)}
          disabled={JSON.stringify(f) === JSON.stringify(EMPTY)}
        >
          <FilterX size={15} aria-hidden />
          {t("Reset filters")}
        </button>
      </div>

      <div className="audit-bar">
        <span className="hint" aria-live="polite">
          {t("{shown} of {total} entries", { shown: rows.length, total })}
        </span>
        <div className="row">
          <button type="button" className="btn ghost sm" onClick={() => void load(f)} disabled={busy}>
            <RefreshCw size={15} aria-hidden className={busy ? "spin" : undefined} />
            {t("Refresh")}
          </button>
          <a className="btn ghost sm" href={exportHref("csv")} download>
            <Download size={15} aria-hidden />
            CSV
          </a>
          <a className="btn ghost sm" href={exportHref("json")} download>
            <Download size={15} aria-hidden />
            JSON
          </a>
        </div>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <div className="audit-box" ref={box} onScroll={onScroll} tabIndex={0} aria-label={t("Security log entries")}>
        <table className="data audit-table">
          <thead>
            <tr>
              <th>{t("ID")}</th>
              <th>{t("Time")}</th>
              <th>{t("Event")}</th>
              <th>{t("By")}</th>
              <th>{t("Concerns")}</th>
              <th>{t("IP address")}</th>
              <th>{t("Details")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className={FAILURE.test(a.event) ? "warn-row" : undefined}>
                <td className="nowrap">
                  <button type="button" className="id-btn" onClick={() => void copy(a.id)} title={t("Copy ID")}>
                    {eventId(a.id)}
                    {copied === a.id ? <span className="copied">✓</span> : <Copy size={12} aria-hidden />}
                  </button>
                </td>
                <td className="nowrap">
                  <time dateTime={new Date(a.ts * 1000).toISOString()}>{date(a.ts, true)}</time>
                </td>
                <td>
                  <span className="ev">{t(EVENT_LABELS[a.event] ?? a.event)}</span>
                  <code className="ev-code">{a.event}</code>
                </td>
                <td>{a.username ?? <span className="hint">—</span>}</td>
                <td>
                  {a.target_name ??
                    (a.target_id ? <span className="hint">#{a.target_id}</span> : <span className="hint">—</span>)}
                </td>
                <td className="nowrap mono">{a.ip ?? <span className="hint">—</span>}</td>
                <td className="detail">{a.detail ?? <span className="hint">—</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && !busy && (
              <tr>
                <td colSpan={7} className="hint" style={{ textAlign: "center", padding: "2rem" }}>
                  {t("No entries match these filters.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {more && (
          <div className="audit-more">
            <button
              type="button"
              className="btn ghost sm"
              disabled={busy}
              onClick={() => void load(f, rows[rows.length - 1]?.id)}
            >
              {busy ? t("Loading…") : t("Load older entries")}
            </button>
          </div>
        )}
      </div>
      <p className="hint">
        {t(
          "Without a reverse proxy the client IP is unknown, so the IP column stays empty. Exports contain exactly the entries matching the current filters.",
        )}
      </p>
    </section>
  );
}
