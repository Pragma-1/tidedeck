import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { Editor } from "@/components/editor";
import { gate } from "@/lib/guard";
import { getPage, getTree, parentOptions } from "@/lib/pages";
import { SLUG_RE } from "@/lib/validate";
import { getT } from "@/lib/i18n-server";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: (await getT())("Edit page") };
}

export default async function EditPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await gate("edit");
  if (!SLUG_RE.test(slug)) notFound();
  const page = await getPage(slug);
  if (!page) notFound();
  return (
    <Shell active={page.slug} rev={page.rev} editing>
      <Editor
        key={page.rev}
        mode="edit"
        slug={page.slug}
        initial={{ title: page.title, content: page.content, parentId: page.parent_id, rev: page.rev }}
        parents={parentOptions(await getTree(), page.id)}
      />
    </Shell>
  );
}
