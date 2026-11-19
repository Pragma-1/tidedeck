import { api } from "@/lib/api";
import { audit, eventId, exportAudit, EVENT_LABELS, toCsv } from "@/lib/audit";
import { parseAuditFilter } from "@/lib/audit-filter";
import { download, stamp } from "@/lib/download";
export const dynamic = "force-dynamic";

export const GET = api("admin", async ({ req, user, ip, t }) => {
  const f = parseAuditFilter(req.nextUrl.searchParams);
  const rows = (await exportAudit(f)).map((a) => ({
    id: eventId(a.id),
    time: new Date(a.ts * 1000).toISOString(),
    event: a.event,
    description: t(EVENT_LABELS[a.event] ?? a.event),
    by: a.username ?? "",
    about: a.target_name ?? "",
    ip: a.ip ?? "",
    detail: a.detail ?? "",
  }));
  await audit(
    "admin.export",
    user!.id,
    ip,
    `security log (${rows.length} entries${f.userId ? `, user #${f.userId}` : ""})`,
    f.userId ?? null,
  );
  const name = `security-log${f.userId ? `-user-${f.userId}` : ""}-${stamp()}`;
  if (req.nextUrl.searchParams.get("format") === "csv")
    return download(
      toCsv(rows, ["id", "time", "event", "description", "by", "about", "ip", "detail"]),
      `${name}.csv`,
      "text/csv",
    );
  return download(
    JSON.stringify({ exported_at: new Date().toISOString(), filter: f, entries: rows }, null, 2),
    `${name}.json`,
    "application/json",
  );
});
