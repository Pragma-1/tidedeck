import Link from "next/link";
import { Shell } from "@/components/shell";
import { PageManager } from "@/components/page-manager";
import { gate } from "@/lib/guard";
import { listPages } from "@/lib/pages";
import { getT } from "@/lib/i18n-server";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: (await getT())("Manage pages") };
}

/** All pages as a tree with checkboxes, for deleting several at once. Editors and up. */
export default async function ManagePages() {
  const user = (await gate("edit"))!;
  const t = await getT();
  const isAdmin = user.role === "admin";
  const pages = (await listPages()).map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    parent_id: p.parent_id,
    author: p.author,
    updated_at: p.updated_at,
    mine: isAdmin || p.created_by === user.id,
  }));
  return (
    <Shell wide>
      <h1 style={{ marginTop: 0 }}>{t("Manage pages")}</h1>
      <p className="hint" style={{ marginTop: "-.4rem" }}>
        {t("Select pages to delete several at once. Deleted pages wait in the trash for 30 days.")}{" "}
        <Link href="/trash">{t("Open the trash")}</Link>
      </p>
      <PageManager pages={pages} isAdmin={isAdmin} />
    </Shell>
  );
}
