import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { TrashPurgeButton, TrashRestoreButton } from "@/components/trash-actions";
import { gate } from "@/lib/guard";
import { getTrashItem, TRASH_DAYS } from "@/lib/trash";
import { renderMarkdown } from "@/lib/markdown";
import { getLang, getT } from "@/lib/i18n-server";
import { formatDate, makeT } from "@/lib/i18n";
import { getSettings, renderSettings } from "@/lib/settings";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: (await getT())("Trash") };
}

/** Read-only preview of a deleted page, so nobody has to restore it just to see what it was. */
export default async function TrashItem({ params }: { params: Promise<{ id: string }> }) {
  const user = (await gate("edit"))!;
  const { id } = await params;
  if (!/^[1-9]\d{0,15}$/.test(id)) notFound();
  const item = await getTrashItem(Number(id));
  if (!item) notFound();
  const lang = await getLang();
  const t = makeT(lang);
  const { html } = renderMarkdown(item.content, {
    lang,
    ...renderSettings(await getSettings()),
  });
  return (
    <Shell wide>
      <div className="crumbs">
        <Link href="/trash">← {t("Back to the trash")}</Link>
      </div>
      <div className="notice trash-banner" role="note">
        <div>
          {t("Deleted on {date}. Removed for good after {days} days unless restored.", {
            date: formatDate(item.deleted_at, lang),
            days: TRASH_DAYS,
          })}
        </div>
        <div className="row">
          <TrashRestoreButton id={item.id} title={item.title} />
          {user.role === "admin" && <TrashPurgeButton id={item.id} title={item.title} back />}
        </div>
      </div>
      <h1>{item.title}</h1>
      <p className="meta">
        /w/{item.slug} · {t("version {n}", { n: item.rev })}
      </p>
      <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
    </Shell>
  );
}
