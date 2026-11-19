import Link from "next/link";
import { Shell } from "@/components/shell";
import { TrashPurgeButton, TrashRestoreButton } from "@/components/trash-actions";
import { gate } from "@/lib/guard";
import { listTrash, TRASH_DAYS } from "@/lib/trash";
import { getLang, getT } from "@/lib/i18n-server";
import { formatDate, makeT } from "@/lib/i18n";
import { now } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: (await getT())("Trash") };
}

export default async function Trash() {
  const user = (await gate("edit"))!; // editors and up only
  const lang = await getLang();
  const t = makeT(lang);
  const rows = await listTrash();
  const isAdmin = user.role === "admin";
  const daysLeft = (deletedAt: number) => Math.max(0, Math.ceil((deletedAt + TRASH_DAYS * 86400 - now()) / 86400));
  return (
    <Shell wide>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div>
          <h1 style={{ marginTop: 0 }}>{t("Trash")}</h1>
          <p className="hint" style={{ marginTop: "-.4rem" }}>
            {t(
              "Deleted pages wait here with their whole history for {days} days, then they are removed for good. Only editors and administrators see the trash.",
              { days: TRASH_DAYS },
            )}
          </p>
        </div>
        {isAdmin && rows.length > 0 && <TrashPurgeButton />}
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t("Page")}</th>
              <th>{t("Deleted")}</th>
              <th>{t("By")}</th>
              <th className="right">{t("Removed in")}</th>
              <th>
                <span className="sr-only">{t("Actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const left = daysLeft(r.deleted_at);
              return (
                <tr key={r.id}>
                  <td>
                    <Link href={`/trash/${r.id}`}>{r.title}</Link>
                    <div className="meta mono">
                      /w/{r.slug}
                      {r.parent_title ? ` · ${t("in {chapter}", { chapter: r.parent_title })}` : ""} ·{" "}
                      {t("version {n}", { n: r.rev })}
                    </div>
                  </td>
                  <td className="nowrap">{formatDate(r.deleted_at, lang)}</td>
                  <td>{r.deleted_by_name ?? <span className="hint">{t("deleted account or system")}</span>}</td>
                  <td className={`right nowrap${left <= 3 ? " neg" : ""}`}>
                    {left <= 1 ? t("within a day") : t("{n} days", { n: left })}
                  </td>
                  <td className="right nowrap">
                    <div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      <TrashRestoreButton id={r.id} title={r.title} compact />
                      {isAdmin && <TrashPurgeButton id={r.id} title={r.title} />}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="hint" style={{ textAlign: "center", padding: "2rem" }}>
                  {t("The trash is empty.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!isAdmin && rows.length > 0 && (
        <p className="hint">{t("Only administrators can delete pages from the trash before the time is up.")}</p>
      )}
    </Shell>
  );
}
