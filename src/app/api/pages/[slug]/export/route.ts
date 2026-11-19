import { api } from "@/lib/api";
import { getPage, getRevision } from "@/lib/pages";
import { toMarkdownFile } from "@/lib/transfer";
import { download } from "@/lib/download";
import { HttpError, SLUG_RE } from "@/lib/validate";
export const dynamic = "force-dynamic";

// One page — or, with ?rev=N, one of its earlier versions — as a Markdown file with front matter.
// Signed-in people only (the history is not public either).
export const GET = api<{ slug: string }>("user", async ({ params, req }) => {
  if (!SLUG_RE.test(params.slug) || params.slug.length > 80) throw new HttpError(404, "Page not found.");
  const p = await getPage(params.slug);
  if (!p) throw new HttpError(404, "Page not found.");
  const r = req.nextUrl.searchParams.get("rev");
  if (r === null) return download(toMarkdownFile(p.title, p.content), `${p.slug}.md`, "text/markdown");
  if (!/^[1-9]\d{0,8}$/.test(r)) throw new HttpError(404, "This version doesn’t exist.");
  const v = await getRevision(p.id, Number(r));
  if (!v) throw new HttpError(404, "This version doesn’t exist.");
  return download(toMarkdownFile(v.title, v.content), `${p.slug}-v${v.rev}.md`, "text/markdown");
});
