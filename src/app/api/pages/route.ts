import { api, json } from "@/lib/api";
import { LIMITS } from "@/lib/config";
import { createPage } from "@/lib/pages";
import { editComment, HttpError, int, SLUG_RE, str } from "@/lib/validate";
import { trashPages } from "@/lib/trash";
import { audit } from "@/lib/audit";
import { consume } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";

export const POST = api("editor", async ({ body, user, ip }) => {
  if (!(await consume(`write:${user!.id}`, 120, 600))) throw new HttpError(429, "Slow down a little.");
  const b = await body(LIMITS.pageBytes + 8192);
  const title = str(b.title, "Title", { max: LIMITS.titleChars });
  const content = str(b.content, "Content", { max: LIMITS.pageBytes, optional: true, trim: false });
  const parentId = b.parentId === null || b.parentId === undefined ? null : int(b.parentId, "Chapter");
  if (Buffer.byteLength(content) > LIMITS.pageBytes) throw new HttpError(413, "This page is too large.");
  const p = await createPage({ title, content, parentId, userId: user!.id, comment: editComment(b.comment) });
  await audit("page.created", user!.id, ip, `${p.slug} (${p.title})`);
  return json({ slug: p.slug, rev: p.rev }, 201);
});

/** Most pages one request may delete; enough for a big clean-up, small enough for one transaction. */
const BULK_MAX = 500;

/**
 * Deletes several pages at once (they go to the trash, with their histories, for 30 days).
 * Body: { slugs: ["a", "b", …] }. Editors may delete pages they created, administrators any page.
 * All or nothing: one page the user may not delete and nothing is deleted.
 */
export const DELETE = api("editor", async ({ body, user, ip }) => {
  if (!(await consume(`write:${user!.id}`, 120, 600))) throw new HttpError(429, "Slow down a little.");
  if (!(await consume(`bulk-delete:${user!.id}`, 30, 600))) throw new HttpError(429, "Slow down a little.");
  const b = await body(64 * 1024);
  if (!Array.isArray(b.slugs) || b.slugs.length === 0) throw new HttpError(400, "Select at least one page.", "slugs");
  if (b.slugs.length > BULK_MAX) throw new HttpError(400, "Select at most 500 pages at once.", "slugs");
  const slugs = [...new Set(b.slugs as unknown[])].map((s) => {
    if (typeof s !== "string" || s.length > 80 || !SLUG_RE.test(s)) throw new HttpError(400, "Invalid page.", "slugs");
    return s;
  });
  const isAdmin = user!.role === "admin";
  const r = await trashPages(slugs, user!.id, (p) => isAdmin || p.created_by === user!.id);
  for (const p of r.trashed) await audit("page.trashed", user!.id, ip, `${p.slug} (${p.title})`);
  return json({ trashed: r.trashed.length, missing: r.missing });
});
