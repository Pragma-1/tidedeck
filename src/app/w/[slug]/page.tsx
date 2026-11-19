import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, Download, History, Link2, Pencil } from "lucide-react";
import { Shell } from "@/components/shell";
import { DeleteButton } from "@/components/page-actions";
import { Notice } from "@/components/ui";
import { gate } from "@/lib/guard";
import { backlinks, breadcrumbs, getPage, getTree, readingOrder, type TreeNode } from "@/lib/pages";
import { renderMarkdown } from "@/lib/markdown";
import { getLang } from "@/lib/i18n-server";
import { formatDate, makeT } from "@/lib/i18n";
import { SLUG_RE } from "@/lib/validate";
import { getSettings, renderSettings } from "@/lib/settings";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams?: Promise<{ moved?: string }> };
const find = (nodes: TreeNode[], id: number): TreeNode | undefined => {
  for (const n of nodes) {
    if (n.id === id) return n;
    const f = find(n.children, id);
    if (f) return f;
  }
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const t = makeT(await getLang());
  return { title: SLUG_RE.test(slug) ? ((await getPage(slug))?.title ?? t("Page not found")) : t("Page not found") };
}

export default async function WikiPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const moved = (await searchParams)?.moved === "1";
  const user = await gate("read");
  if (!SLUG_RE.test(slug) || slug.length > 80) notFound();
  const page = await getPage(slug);
  if (!page) notFound();
  const children = find(await getTree(), page.id)?.children ?? [];
  const canEdit = !!user && user.role !== "viewer";
  const canDelete = !!user && (user.role === "admin" || (user.role !== "viewer" && page.created_by === user.id));
  const crumbs = await breadcrumbs(page);
  const linkedFrom = await backlinks(page.slug);
  const order = await readingOrder();
  const at = order.findIndex((o) => o.slug === page.slug);
  const prev = at > 0 ? order[at - 1] : null,
    next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
  const lang = await getLang();
  const t = makeT(lang);
  const { html, toc } = renderMarkdown(page.content, {
    lang,
    ...renderSettings(await getSettings()),
  });
  return (
    <Shell active={page.slug} rev={page.rev}>
      <div className="doc-grid">
        <article>
          {crumbs.length > 0 && (
            <nav className="crumbs" aria-label={t("Breadcrumb")}>
              {crumbs.map((c) => (
                <span key={c.slug}>
                  <Link href={`/w/${c.slug}`}>{c.title}</Link> /
                </span>
              ))}
            </nav>
          )}
          {moved && canEdit && (
            <Notice>
              {t(
                "Restored from the trash. Another page took the old address meanwhile, so this one is now at /w/{slug}.",
                {
                  slug: page.slug,
                },
              )}
            </Notice>
          )}
          <div className="doc-head">
            <div>
              <h1>{page.title}</h1>
              <p className="meta">
                {t("Updated {date}", { date: formatDate(page.updated_at, lang) })}
                {page.editor
                  ? ` · ${t("by {name}", { name: page.editor })}`
                  : page.updated_by === null && page.rev > 1
                    ? ` · ${t("by a deleted account or the system")}`
                    : ""}{" "}
                · {t("version {n}", { n: page.rev })}
              </p>
            </div>
            <div className="row">
              {canEdit && (
                <Link className="btn sm" href={`/w/${page.slug}/edit`}>
                  <Pencil size={15} aria-hidden />
                  {t("Edit")}
                </Link>
              )}
              {user && (
                <Link className="btn ghost sm" href={`/w/${page.slug}/history`}>
                  <History size={15} aria-hidden />
                  {t("History")}
                </Link>
              )}
              {user && (
                <a
                  className="btn ghost sm"
                  href={`/api/pages/${page.slug}/export`}
                  download
                  title={t("Download as Markdown")}
                >
                  <Download size={15} aria-hidden />
                  <span className="sr-only">{t("Download as Markdown")}</span>.md
                </a>
              )}
              {canDelete && <DeleteButton slug={page.slug} title={page.title} />}
            </div>
          </div>
          {/* Safe: output of renderMarkdown() — raw HTML disabled at parse time, then allow-list sanitised. */}
          <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
          {linkedFrom.length > 0 && (
            <section className="backlinks">
              <h2 className="section-title">
                <Link2 size={16} aria-hidden /> {t("Linked from")}
              </h2>
              <ul>
                {linkedFrom.map((b) => (
                  <li key={b.slug}>
                    <Link href={`/w/${b.slug}`}>{b.title}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {children.length > 0 && (
            <section style={{ marginTop: "2.5rem" }}>
              <h2 className="section-title">{t("In this chapter")}</h2>
              <ul className="recent">
                {children.map((c) => (
                  <li key={c.id}>
                    <Link href={`/w/${c.slug}`}>{c.title}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(prev || next) && (
            <nav className="pager" aria-label={t("Previous and next page")}>
              {prev ? (
                <Link href={`/w/${prev.slug}`} className="pager-prev">
                  <span className="hint">
                    <ArrowLeft size={14} aria-hidden /> {t("Previous")}
                  </span>
                  <strong>{prev.title}</strong>
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link href={`/w/${next.slug}`} className="pager-next">
                  <span className="hint">
                    {t("Next")} <ArrowRight size={14} aria-hidden />
                  </span>
                  <strong>{next.title}</strong>
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </article>
        {toc.length > 1 && (
          <aside className="toc" aria-label={t("On this page")}>
            <p>{t("On this page")}</p>
            <ul>
              {toc.map((t) => (
                <li key={t.id} className={`l${t.level}`}>
                  <a href={`#${t.id}`}>{t.text}</a>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </Shell>
  );
}
