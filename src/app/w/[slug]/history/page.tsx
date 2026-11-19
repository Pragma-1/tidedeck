import Link from "next/link";
import { notFound } from "next/navigation";
import { diffLines } from "diff";
import { Download, Eye, GitCompare, RotateCcw } from "lucide-react";
import { Shell } from "@/components/shell";
import { RestoreVersionButton } from "@/components/page-actions";
import { gate } from "@/lib/guard";
import { getPage, getRevision, listRevisions, revisionCount, type RevisionRow } from "@/lib/pages";
import { renderMarkdown } from "@/lib/markdown";
import { getLang, getT } from "@/lib/i18n-server";
import { formatDate, makeT, type T } from "@/lib/i18n";
import { SLUG_RE } from "@/lib/validate";
import { getSettings, renderSettings } from "@/lib/settings";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: (await getT())("History") };
}

const revParam = (v?: string) => (v && /^\d{1,6}$/.test(v) ? Number(v) : undefined);

/** Line diff, rendered as escaped text by React. Long unchanged stretches collapse to 3 lines of context. */
function Diff({ from, to, t }: { from: string; to: string; t: T }) {
  // Time-boxed: two completely different 512 KB versions must not tie up the server.
  const parts = diffLines(from, to, { timeout: 1500, maxEditLength: 20000 });
  if (!parts) return <p className="hint">{t("These versions are too different to compare line by line.")}</p>;
  let added = 0,
    removed = 0;
  const rows: { kind: "add" | "del" | "same" | "skip"; text: string }[] = [];
  for (const p of parts) {
    const lines = p.value.replace(/\n$/, "").split("\n");
    if (p.added) {
      added += lines.length;
      lines.forEach((l) => rows.push({ kind: "add", text: l }));
    } else if (p.removed) {
      removed += lines.length;
      lines.forEach((l) => rows.push({ kind: "del", text: l }));
    } else if (lines.length > 8) {
      lines.slice(0, 3).forEach((l) => rows.push({ kind: "same", text: l }));
      rows.push({ kind: "skip", text: t("{n} unchanged lines", { n: lines.length - 6 }) });
      lines.slice(-3).forEach((l) => rows.push({ kind: "same", text: l }));
    } else lines.forEach((l) => rows.push({ kind: "same", text: l }));
  }
  return (
    <div className="diff">
      <p className="hint">
        <span className="diff-add-count">+{added}</span> <span className="diff-del-count">−{removed}</span> {t("lines")}
      </p>
      {added + removed === 0 ? (
        <p className="hint">{t("The text is identical.")}</p>
      ) : (
        <pre className="diff-body">
          {rows.map((r, i) => (
            <div key={i} className={`dl dl-${r.kind}`}>
              <span className="dm" aria-hidden>
                {r.kind === "add" ? "+" : r.kind === "del" ? "−" : r.kind === "skip" ? "⋯" : " "}
              </span>
              <span className="sr-only">{r.kind === "add" ? t("added") : r.kind === "del" ? t("removed") : ""}</span>
              {r.text || " "}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

/** The little labels under a version: who, when, the edit summary, and where a restore came from. */
function RevMeta({ r, lang, t }: { r: RevisionRow; lang: "de" | "en"; t: T }) {
  return (
    <>
      <span className="meta">
        {formatDate(r.created_at, lang)} · {r.author ?? t("deleted account or system")}
      </span>
      {r.restored_from !== null && (
        <span className="rev-note">
          <RotateCcw size={12} aria-hidden /> {t("restored from version {n}", { n: r.restored_from })}
        </span>
      )}
      {r.comment && <span className="rev-comment">{r.comment}</span>}
    </>
  );
}

export default async function History({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ rev?: string; from?: string; to?: string; before?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const user = await gate("user"); // version history only for signed-in people
  if (!SLUG_RE.test(slug)) notFound();
  const page = await getPage(slug);
  if (!page) notFound();
  const before = revParam(sp.before);
  const revs = await listRevisions(page.id, before);
  const total = await revisionCount(page.id);
  const lang = await getLang();
  const t = makeT(lang);
  const canEdit = !!user && user.role !== "viewer";
  const fromN = revParam(sp.from),
    toN = revParam(sp.to);
  const comparing = fromN !== undefined && toN !== undefined;
  const from = comparing ? await getRevision(page.id, fromN) : undefined,
    to = comparing ? await getRevision(page.id, toN) : undefined;
  const wanted = !comparing
    ? revParam(sp.rev) !== undefined
      ? await getRevision(page.id, revParam(sp.rev)!)
      : undefined
    : undefined;
  const base = `/w/${page.slug}/history`;
  const keep = before ? `&before=${before}` : "";
  return (
    <Shell active={page.slug} rev={page.rev} wide>
      <div className="crumbs">
        <Link href={`/w/${page.slug}`}>← {t("Back to {title}", { title: page.title })}</Link>
      </div>
      <h1 style={{ marginTop: 0 }}>{t("History")}</h1>
      <p className="hint" style={{ marginTop: "-.4rem" }}>
        {t(
          "{n} versions. Every save is kept; restoring an older version adds it as a new version on top, so nothing is ever overwritten.",
          { n: total },
        )}
      </p>
      <div className="history-grid">
        <div className="rev-list">
          {/* the list itself is not a form: restore buttons open dialogs, which may not sit inside a form */}
          <form id="rev-compare" method="get" action={base} />
          {before && <input type="hidden" name="before" value={before} form="rev-compare" />}
          <p className="hint">{t("Pick two versions to compare them.")}</p>
          <ul className="recent">
            {revs.map((r, i) => {
              const current = r.rev === page.rev;
              return (
                <li key={r.rev} className={wanted?.rev === r.rev ? "rev-active" : undefined}>
                  <span className="rev-pick">
                    <input
                      type="radio"
                      name="from"
                      form="rev-compare"
                      value={r.rev}
                      defaultChecked={fromN !== undefined ? fromN === r.rev : !before && i === 1}
                      aria-label={t("Compare from version {n}", { n: r.rev })}
                    />
                    <input
                      type="radio"
                      name="to"
                      form="rev-compare"
                      value={r.rev}
                      defaultChecked={toN !== undefined ? toN === r.rev : !before && i === 0}
                      aria-label={t("Compare to version {n}", { n: r.rev })}
                    />
                  </span>
                  <span className="rev-main">
                    <span>
                      <Link
                        href={`${base}?rev=${r.rev}${keep}`}
                        aria-current={wanted?.rev === r.rev ? "true" : undefined}
                      >
                        {t("Version {n}", { n: r.rev })}
                      </Link>
                      {current && <span className="badge">{t("current")}</span>}
                    </span>
                    <RevMeta r={r} lang={lang} t={t} />
                  </span>
                  <span className="rev-actions">
                    <Link
                      className="icon-btn plain"
                      href={`${base}?rev=${r.rev}${keep}`}
                      title={t("View version {n}", { n: r.rev })}
                      aria-label={t("View version {n}", { n: r.rev })}
                    >
                      <Eye size={15} aria-hidden />
                    </Link>
                    {!current && (
                      <Link
                        className="icon-btn plain"
                        href={`${base}?from=${r.rev}&to=${page.rev}${keep}`}
                        title={t("Compare version {n} with the current one", { n: r.rev })}
                        aria-label={t("Compare version {n} with the current one", { n: r.rev })}
                      >
                        <GitCompare size={15} aria-hidden />
                      </Link>
                    )}
                    <a
                      className="icon-btn plain"
                      href={`/api/pages/${page.slug}/export?rev=${r.rev}`}
                      download
                      title={t("Download version {n} as Markdown", { n: r.rev })}
                      aria-label={t("Download version {n} as Markdown", { n: r.rev })}
                    >
                      <Download size={15} aria-hidden />
                    </a>
                    {canEdit && !current && (
                      <RestoreVersionButton slug={page.slug} rev={r.rev} currentRev={page.rev} compact />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="row">
            {revs.length > 1 && (
              <button className="btn sm" type="submit" form="rev-compare">
                <GitCompare size={15} aria-hidden />
                {t("Compare")}
              </button>
            )}
            {before && (
              <Link className="btn ghost sm" href={base}>
                {t("Newest versions")}
              </Link>
            )}
            {revs.length === 100 && revs[revs.length - 1].rev > 1 && (
              <Link className="btn ghost sm" href={`${base}?before=${revs[revs.length - 1].rev}`}>
                {t("Older versions")}
              </Link>
            )}
          </div>
        </div>
        <div>
          {comparing && from && to ? (
            <>
              <h2 className="section-title" style={{ marginTop: 0 }}>
                {t("Version {a} → version {b}", { a: from.rev, b: to.rev })}
              </h2>
              {from.title !== to.title && (
                <p className="hint">
                  {t("Title")}: <del>{from.title}</del> → <ins>{to.title}</ins>
                </p>
              )}
              <Diff from={from.content} to={to.content} t={t} />
            </>
          ) : wanted ? (
            <>
              <div className="row between" style={{ marginBottom: "1rem" }}>
                <div className="rev-main">
                  <strong>
                    {wanted.title} — {t("version {n}", { n: wanted.rev })}
                  </strong>
                  {wanted.comment && <span className="rev-comment">{wanted.comment}</span>}
                  {wanted.restored_from !== null && (
                    <span className="rev-note">
                      <RotateCcw size={12} aria-hidden /> {t("restored from version {n}", { n: wanted.restored_from })}
                    </span>
                  )}
                </div>
                <div className="row">
                  {wanted.rev > 1 && (
                    <Link className="btn ghost sm" href={`${base}?from=${wanted.rev - 1}&to=${wanted.rev}`}>
                      <GitCompare size={15} aria-hidden />
                      {t("Changes in this version")}
                    </Link>
                  )}
                  {wanted.rev !== page.rev && (
                    <Link className="btn ghost sm" href={`${base}?from=${wanted.rev}&to=${page.rev}`}>
                      <GitCompare size={15} aria-hidden />
                      {t("Compare with current")}
                    </Link>
                  )}
                  <a className="btn ghost sm" href={`/api/pages/${page.slug}/export?rev=${wanted.rev}`} download>
                    <Download size={15} aria-hidden />
                    .md
                  </a>
                  {canEdit && wanted.rev !== page.rev && (
                    <RestoreVersionButton slug={page.slug} rev={wanted.rev} currentRev={page.rev} />
                  )}
                </div>
              </div>
              <div
                className="md"
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(wanted.content, {
                    lang,
                    ...renderSettings(await getSettings()),
                  }).html,
                }}
              />
            </>
          ) : (
            <p className="hint">{t("Pick a version to preview it.")}</p>
          )}
        </div>
      </div>
    </Shell>
  );
}
