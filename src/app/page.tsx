import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { Shell } from "@/components/shell";
import { gate } from "@/lib/guard";
import { getTree, recentPages, type TreeNode } from "@/lib/pages";
import { getSettings } from "@/lib/settings";
import { getLang } from "@/lib/i18n-server";
import { formatDate, makeT } from "@/lib/i18n";
export const dynamic = "force-dynamic";

const flatten = (n: TreeNode): TreeNode[] => n.children.flatMap((c) => [c, ...flatten(c)]);

export default async function Home() {
  const user = await gate("read");
  const cfg = await getSettings();
  const tree = await getTree();
  const recent = await recentPages(8);
  const canEdit = !!user && user.role !== "viewer";
  const lang = await getLang();
  const t = makeT(lang);
  return (
    <Shell>
      <section className="hero">
        <h1>{cfg.site_name}</h1>
        <div>
          <p>{t("Chapters and pages, kept current by the people who use them.")}</p>
          {!user && (
            <p style={{ fontSize: ".95rem" }}>
              {t("You’re reading in view-only mode.")} <Link href="/login">{t("Sign in to edit.")}</Link>
            </p>
          )}
        </div>
      </section>
      {tree.length === 0 ? (
        <div className="empty">
          {t("Nothing has been written yet.")}
          {canEdit && (
            <>
              {" "}
              <Link href="/new">{t("Write the first page")}</Link>
            </>
          )}
        </div>
      ) : (
        <div className="chapters">
          {tree.map((c) => (
            <section className="chapter" key={c.id}>
              <h2>
                <Link href={`/w/${c.slug}`}>{c.title}</Link>
              </h2>
              {c.children.length > 0 && (
                <ul>
                  {flatten(c).map((p) => (
                    <li key={p.id}>
                      <Link href={`/w/${p.slug}`}>{p.title}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <>
          <h2 className="section-title">{t("Recently changed")}</h2>
          <ul className="recent">
            {recent.map((p) => (
              <li key={p.id}>
                <Link href={`/w/${p.slug}`}>{p.title}</Link>
                <time dateTime={new Date(p.updated_at * 1000).toISOString()}>{formatDate(p.updated_at, lang)}</time>
              </li>
            ))}
          </ul>
        </>
      )}
      {canEdit && (
        <p style={{ marginTop: "2rem" }}>
          <Link className="btn" href="/new">
            <FilePlus2 size={16} aria-hidden />
            {t("New page")}
          </Link>
        </p>
      )}
    </Shell>
  );
}
