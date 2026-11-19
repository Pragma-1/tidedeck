import { api, json } from "@/lib/api";
import { getPage, restoreRevision } from "@/lib/pages";
import { HttpError, int, SLUG_RE } from "@/lib/validate";
import { audit } from "@/lib/audit";
import { consume } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";

/** Puts an older version back as a new version on top. Body: { rev, expectedRev }. */
export const POST = api<{ slug: string }>("editor", async ({ body, user, params, ip }) => {
  if (!SLUG_RE.test(params.slug) || params.slug.length > 80) throw new HttpError(404, "Page not found.");
  if (!(await consume(`write:${user!.id}`, 120, 600))) throw new HttpError(429, "Slow down a little.");
  const b = await body(1024);
  const rev = int(b.rev, "Version");
  if (rev < 1) throw new HttpError(404, "This version doesn’t exist.");
  if (!(await getPage(params.slug))) throw new HttpError(404, "Page not found.");
  const p = await restoreRevision(params.slug, rev, { expectedRev: int(b.expectedRev, "Revision"), userId: user!.id });
  await audit("page.version_restored", user!.id, ip, `${p.slug} v${rev} → v${p.rev}`);
  return json({ slug: p.slug, rev: p.rev });
});
