import { api, json } from "@/lib/api";
import { LIMITS } from "@/lib/config";
import { getPage, updatePage } from "@/lib/pages";
import { trashPage } from "@/lib/trash";
import { editComment, HttpError, int, SLUG_RE, str } from "@/lib/validate";
import { audit } from "@/lib/audit";
import { consume } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";

type P = { slug: string };
const slugOf = (s: string) => {
  if (!SLUG_RE.test(s) || s.length > 80) throw new HttpError(404, "Page not found.");
  return s;
};

export const PUT = api<P>("editor", async ({ body, user, params }) => {
  const slug = slugOf(params.slug);
  if (!(await consume(`write:${user!.id}`, 120, 600))) throw new HttpError(429, "Slow down a little.");
  const b = await body(LIMITS.pageBytes + 8192);
  const title = str(b.title, "Title", { max: LIMITS.titleChars });
  const content = str(b.content, "Content", { max: LIMITS.pageBytes, optional: true, trim: false });
  const parentId = b.parentId === null || b.parentId === undefined ? null : int(b.parentId, "Chapter");
  if (Buffer.byteLength(content) > LIMITS.pageBytes) throw new HttpError(413, "This page is too large.");
  const p = await updatePage(slug, {
    title,
    content,
    parentId,
    expectedRev: int(b.expectedRev, "Revision"),
    userId: user!.id,
    comment: editComment(b.comment),
  });
  return json({ slug: p.slug, rev: p.rev });
});

export const DELETE = api<P>("editor", async ({ user, params, ip }) => {
  const page = await getPage(slugOf(params.slug));
  if (!page) throw new HttpError(404, "Page not found.");
  if (user!.role !== "admin" && page.created_by !== user!.id)
    throw new HttpError(403, "Only the author or an administrator can delete this page.");
  // Not gone yet: the page and its whole history wait in the trash for 30 days.
  await trashPage(page.slug, user!.id);
  await audit("page.trashed", user!.id, ip, `${page.slug} (${page.title})`);
  return json({ ok: true });
});
