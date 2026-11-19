import { all, one, run, sql, Sql, now } from "./db";
import { translate } from "./i18n";
import { CATEGORIES, EVENT_LABELS, type AuditRow, type Category } from "./audit-shared";
export { CATEGORIES, EVENT_LABELS, eventId, type AuditRow, type Category } from "./audit-shared";

/** Security-relevant events only. Never put secrets, passwords or tokens into `detail`. */
export async function audit(
  event: string,
  userId: number | null,
  ip: string | null,
  detail?: string,
  targetId?: number | null,
) {
  // control characters (incl. NUL) never reach the log: it is rendered and exported as CSV
  const d = detail ? detail.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300) : null;
  await run(
    sql`INSERT INTO audit_log(ts, user_id, event, ip, detail, target_id)
        VALUES (${now()}, ${userId}, ${event}, ${ip}, ${d}, ${targetId ?? null})`,
  );
}

export type AuditFilter = {
  q?: string;
  category?: Category;
  userId?: number;
  from?: number;
  to?: number;
  before?: number;
  limit?: number;
};

const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function where(f: AuditFilter): Sql {
  const parts: Sql[] = [];
  if (f.category && Object.prototype.hasOwnProperty.call(CATEGORIES, f.category)) {
    const ps = CATEGORIES[f.category].prefixes.map((p) => `${p.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    parts.push(
      sql`(${sql.join(
        ps.map((p) => sql`a.event LIKE ${p}`),
        sql` OR `,
      )})`,
    );
  }
  if (f.userId) parts.push(sql`(a.user_id = ${f.userId} OR a.target_id = ${f.userId})`);
  if (f.from) parts.push(sql`a.ts >= ${f.from}`);
  if (f.to) parts.push(sql`a.ts < ${f.to}`);
  if (f.before) parts.push(sql`a.id < ${f.before}`);
  const q = f.q?.trim();
  if (q) {
    const id = /^#?(\d{1,12})$/.exec(q);
    const needle = q.toLowerCase();
    // match the visible event names in both languages, so "Angemeldet" finds login.ok just like "Signed in"
    const labelHits = Object.entries(EVENT_LABELS)
      .filter(([, l]) => l.toLowerCase().includes(needle) || translate("de", l).toLowerCase().includes(needle))
      .map(([k]) => k);
    const l = like(q);
    const ors: Sql[] = [
      sql`a.event ILIKE ${l}`,
      sql`a.detail ILIKE ${l}`,
      sql`a.ip ILIKE ${l}`,
      sql`u.username ILIKE ${l}`,
      sql`t.username ILIKE ${l}`,
    ];
    if (id) ors.push(sql`a.id = ${Number(id[1])}`);
    if (labelHits.length) ors.push(sql`a.event = ANY(${labelHits})`);
    parts.push(sql`(${sql.join(ors, sql` OR `)})`);
  }
  return parts.length ? sql`WHERE ${sql.join(parts, sql` AND `)}` : sql``;
}

const BASE = sql`SELECT a.id, a.ts, a.event, a.ip, a.detail, a.user_id, u.username, a.target_id, t.username AS target_name
  FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN users t ON t.id = a.target_id`;

export async function queryAudit(f: AuditFilter): Promise<{ rows: AuditRow[]; total: number }> {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const rows = await all<AuditRow>(sql`${BASE} ${where(f)} ORDER BY a.id DESC LIMIT ${limit}`);
  const total =
    (
      await one<{ n: number }>(
        sql`SELECT COUNT(*) AS n FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
            LEFT JOIN users t ON t.id = a.target_id ${where({ ...f, before: undefined })}`,
      )
    )?.n ?? 0;
  return { rows, total };
}

export async function exportAudit(f: AuditFilter, max = 100_000): Promise<AuditRow[]> {
  return all<AuditRow>(sql`${BASE} ${where({ ...f, before: undefined })} ORDER BY a.id DESC LIMIT ${max}`);
}

/** RFC 4180 CSV with spreadsheet formula injection neutralised (cells starting with = + - @ tab CR). */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}
