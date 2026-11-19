import Link from "next/link";
import { Shell } from "@/components/shell";
import { gate } from "@/lib/guard";
import { recentChanges } from "@/lib/pages";
import { getLang, getT } from "@/lib/i18n-server";
import { formatDate, makeT } from "@/lib/i18n";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: (await getT())("Recent changes") };
}

export default async function Changes({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  await gate("user"); // only for signed-in people
  const b = (await searchParams).before;
  const before = b && /^\d{1,12}$/.test(b) ? Number(b) : undefined;
  const lang = await getLang();
  const t = makeT(lang);
  const rows = await recentChanges(50, before);
  return (
    <Shell wide>
      <h1 style={{ marginTop: 0 }}>{t("Recent changes")}</h1>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t("Time")}</th>
              <th>{t("Page")}</th>
              <th>{t("Version")}</th>
              <th>{t("By")}</th>
              <th className="right">{t("Size")}</th>
              <th>
                <span className="sr-only">{t("Actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const delta = r.prev_len === null ? null : r.len - r.prev_len;
              return (
                <tr key={r.id}>
                  <td className="nowrap">{formatDate(r.created_at, lang)}</td>
                  <td>
                    <Link href={`/w/${r.slug}`}>{r.title}</Link>
                    {(r.comment || r.restored_from !== null) && (
                      <div className="meta">
                        {r.restored_from !== null && t("restored from version {n}", { n: r.restored_from })}
                        {r.restored_from !== null && r.comment && " · "}
                        {r.comment && <em>{r.comment}</em>}
                      </div>
                    )}
                  </td>
                  <td>{r.rev === 1 ? <span className="badge">{t("new")}</span> : r.rev}</td>
                  <td>{r.author ?? <span className="hint">{t("deleted account or system")}</span>}</td>
                  <td className={`right mono ${delta === null ? "" : delta >= 0 ? "pos" : "neg"}`}>
                    {delta === null ? `${r.len}` : `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}`}
                  </td>
                  <td className="right nowrap">
                    {r.rev > 1 && (
                      <Link className="btn ghost sm" href={`/w/${r.slug}/history?from=${r.rev - 1}&to=${r.rev}`}>
                        {t("Changes")}
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="hint" style={{ textAlign: "center", padding: "2rem" }}>
                  {t("No changes yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length === 50 && (
        <p>
          <Link className="btn ghost sm" href={`/changes?before=${rows[rows.length - 1].id}`}>
            {t("Older changes")}
          </Link>
        </p>
      )}
    </Shell>
  );
}
