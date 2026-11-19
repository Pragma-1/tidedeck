import { all, one, run, sql, tx, now } from "./db";
import { LIMITS } from "./config";
import { HttpError, slugify } from "./validate";
import { publish } from "./events";

/* ------------------------------------------------------------------ links */

/** Wiki-internal link targets in a page's Markdown: [[Title]] and [text](/w/slug). */
export function extractLinks(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(/\[\[([^\]\n|]{1,160})(?:\|[^\]\n]{0,160})?\]\]/g)) out.add(slugify(m[1].trim()));
  for (const m of md.matchAll(/\]\(\/w\/([a-z0-9-]{1,80})(?:[#?)][^)]*)?\)?/g)) out.add(m[1]);
  return [...out].filter((s) => SLUG_OK.test(s)).slice(0, 500);
}
const SLUG_OK = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function saveLinks(pageId: number, content: string) {
  await run(sql`DELETE FROM page_links WHERE from_id = ${pageId}`);
  const links = extractLinks(content);
  if (links.length)
    await run(
      sql`INSERT INTO page_links(from_id, to_slug) SELECT ${pageId}::bigint, s FROM unnest(${links}::text[]) AS s
          ON CONFLICT DO NOTHING`,
    );
}

export async function rebuildLinks() {
  await tx(async () => {
    await run(sql`DELETE FROM page_links`);
    for (const p of await all<{ id: number; content: string }>(sql`SELECT id, content FROM pages`))
      await saveLinks(p.id, p.content);
  });
}

/** Pages that link here. */
export function backlinks(slug: string) {
  return all<{ slug: string; title: string }>(
    sql`SELECT p.slug, p.title FROM page_links l JOIN pages p ON p.id = l.from_id
        WHERE l.to_slug = ${slug} AND p.slug <> ${slug} ORDER BY lower(p.title) LIMIT 100`,
  );
}

/** Every saved version across the wiki, newest first (MediaWiki's "recent changes"). */
export function recentChanges(limit = 50, before?: number) {
  return all<{
    id: number;
    rev: number;
    title: string;
    created_at: number;
    comment: string | null;
    restored_from: number | null;
    slug: string;
    author: string | null;
    prev_len: number | null;
    len: number;
  }>(
    sql`SELECT r.id, r.rev, r.title, r.created_at, r.comment, r.restored_from, p.slug, u.username AS author,
          (SELECT length(r2.content) FROM page_revisions r2 WHERE r2.page_id = r.page_id AND r2.rev = r.rev - 1) AS prev_len,
          length(r.content) AS len
        FROM page_revisions r JOIN pages p ON p.id = r.page_id LEFT JOIN users u ON u.id = r.author_id
        ${before ? sql`WHERE r.id < ${before}` : sql``} ORDER BY r.id DESC LIMIT ${limit}`,
  );
}

/** Depth-first reading order, for "previous / next" links. */
export async function readingOrder(): Promise<{ slug: string; title: string }[]> {
  const walk = (ns: TreeNode[]): { slug: string; title: string }[] =>
    ns.flatMap((n) => [{ slug: n.slug, title: n.title }, ...walk(n.children)]);
  return walk(await getTree());
}

export type PageRow = {
  id: number;
  slug: string;
  title: string;
  parent_id: number | null;
  position: number;
  content: string;
  rev: number;
  created_by: number | null;
  updated_by: number | null;
  created_at: number;
  updated_at: number;
  system_key?: string | null;
  author?: string | null;
  editor?: string | null;
};
export type TreeNode = { id: number; slug: string; title: string; parent_id: number | null; children: TreeNode[] };

const SELECT = sql`SELECT p.*, cu.username AS author, uu.username AS editor FROM pages p
  LEFT JOIN users cu ON cu.id = p.created_by LEFT JOIN users uu ON uu.id = p.updated_by`;

export const getPage = (slug: string) => one<PageRow>(sql`${SELECT} WHERE p.slug = ${slug}`);
export const getPageById = (id: number) => one<PageRow>(sql`${SELECT} WHERE p.id = ${id}`);

export async function getTree(): Promise<TreeNode[]> {
  const rows = await all<Omit<TreeNode, "children">>(
    sql`SELECT id, slug, title, parent_id FROM pages ORDER BY position, lower(title)`,
  );
  const nodes = new Map<number, TreeNode>(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots: TreeNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parent_id ? nodes.get(n.parent_id) : undefined;
    (parent ? parent.children : roots).push(n);
  }
  return roots;
}

export const recentPages = (limit = 8) => all<PageRow>(sql`${SELECT} ORDER BY p.updated_at DESC LIMIT ${limit}`);

const likePrefix = (s: string) => `${s.replace(/[\\%_]/g, (c) => `\\${c}`)}-%`;

export async function uniqueSlug(base: string): Promise<string> {
  const taken = new Set(
    (
      await all<{ slug: string }>(
        sql`SELECT slug FROM pages WHERE slug = ${base} OR slug LIKE ${likePrefix(base.slice(0, 74))}`,
      )
    ).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const s = `${base.slice(0, 74)}-${i}`;
    if (!taken.has(s)) return s;
  }
  throw new HttpError(409, "Could not create a unique address for this page.");
}

/** Levels above and including `id` (1 = top level). One recursive query, capped. */
export async function depthOf(id: number | null): Promise<number> {
  if (!id) return 0;
  const r = await one<{ d: number }>(
    sql`WITH RECURSIVE up(id, parent_id, d) AS (
          SELECT id, parent_id, 1 FROM pages WHERE id = ${id}
          UNION ALL SELECT p.id, p.parent_id, up.d + 1 FROM pages p JOIN up ON p.id = up.parent_id WHERE up.d < 21
        ) SELECT COALESCE(MAX(d), 0) AS d FROM up`,
  );
  return r?.d ?? 0;
}

export async function assertParentOk(pageId: number | null, parentId: number | null) {
  if (parentId === null) return;
  const parent = await one(sql`SELECT 1 FROM pages WHERE id = ${parentId}`);
  if (!parent) throw new HttpError(400, "The selected chapter does not exist.", "parentId");
  if (pageId !== null) {
    // refuse cycles: the new parent must not be the page itself or one of its descendants
    const cyc = await one(
      sql`WITH RECURSIVE up(id, parent_id, d) AS (
            SELECT id, parent_id, 0 FROM pages WHERE id = ${parentId}
            UNION ALL SELECT p.id, p.parent_id, up.d + 1 FROM pages p JOIN up ON p.id = up.parent_id WHERE up.d < 50
          ) SELECT 1 FROM up WHERE id = ${pageId} LIMIT 1`,
    );
    if (cyc) throw new HttpError(400, "A page can’t be moved inside itself.", "parentId");
  }
  // the page brings its own sub-pages along: the deepest of them must still fit
  const below = pageId === null ? 0 : await heightBelow(pageId);
  if ((await depthOf(parentId)) + below >= LIMITS.maxPageDepth)
    throw new HttpError(400, `Chapters can be nested ${LIMITS.maxPageDepth} levels deep at most.`, "parentId");
}

/** How many levels of sub-pages hang below `id` (0 = none). Capped like depthOf. */
async function heightBelow(id: number): Promise<number> {
  const r = await one<{ d: number }>(
    sql`WITH RECURSIVE down(id, d) AS (
          SELECT id, 1 FROM pages WHERE parent_id = ${id}
          UNION ALL SELECT p.id, down.d + 1 FROM pages p JOIN down ON p.parent_id = down.id WHERE down.d < 21
        ) SELECT COALESCE(MAX(d), 0) AS d FROM down`,
  );
  return r?.d ?? 0;
}

export type ListedPage = {
  id: number;
  slug: string;
  title: string;
  parent_id: number | null;
  created_by: number | null;
  author: string | null;
  updated_at: number;
  rev: number;
};

/** Every page with what the page manager shows; tree order (position, then title). */
export const listPages = () =>
  all<ListedPage>(
    sql`SELECT p.id, p.slug, p.title, p.parent_id, p.created_by, u.username AS author, p.updated_at, p.rev
        FROM pages p LEFT JOIN users u ON u.id = p.created_by
        ORDER BY p.position, lower(p.title), p.id`,
  );

export async function createPage(input: {
  title: string;
  content: string;
  parentId: number | null;
  userId: number;
  slug?: string;
  comment?: string | null;
}): Promise<PageRow> {
  const t = now();
  const page = await tx(async () => {
    await assertParentOk(null, input.parentId);
    const slug = await uniqueSlug(slugify(input.slug || input.title));
    const pos =
      (
        await one<{ n: number }>(
          sql`SELECT COALESCE(MAX(position), 0) + 1 AS n FROM pages
              WHERE parent_id IS NOT DISTINCT FROM ${input.parentId}::bigint`,
        )
      )?.n ?? 1;
    const r = await one<{ id: number }>(
      sql`INSERT INTO pages(slug, title, parent_id, position, content, rev, created_by, updated_by, created_at, updated_at)
          VALUES (${slug}, ${input.title}, ${input.parentId}, ${pos}, ${input.content}, 1,
                  ${input.userId}, ${input.userId}, ${t}, ${t})
          RETURNING id`,
    );
    const id = r!.id;
    await run(
      sql`INSERT INTO page_revisions(page_id, rev, title, content, author_id, created_at, comment)
          VALUES (${id}, 1, ${input.title}, ${input.content}, ${input.userId}, ${t}, ${input.comment || null})`,
    );
    await saveLinks(id, input.content);
    return (await getPageById(id))!;
  });
  publish({ type: "page.created", slug: page.slug, title: page.title, rev: page.rev });
  return page;
}

export async function updatePage(
  slug: string,
  input: {
    title: string;
    content: string;
    parentId: number | null;
    expectedRev: number;
    userId: number;
    comment?: string | null;
    restoredFrom?: number | null;
  },
): Promise<PageRow> {
  const t = now();
  const page = await tx(async () => {
    const cur = await getPage(slug);
    if (!cur) throw new HttpError(404, "Page not found.");
    if (cur.rev !== input.expectedRev)
      throw new HttpError(
        409,
        "Someone else saved this page while you were editing. Copy your changes, reload, and merge them.",
      );
    if (input.parentId !== cur.parent_id) await assertParentOk(cur.id, input.parentId);
    const rev = cur.rev + 1;
    await run(
      sql`UPDATE pages SET title = ${input.title}, content = ${input.content}, parent_id = ${input.parentId},
            rev = ${rev}, updated_by = ${input.userId}, updated_at = ${t}
          WHERE id = ${cur.id}`,
    );
    await run(
      sql`INSERT INTO page_revisions(page_id, rev, title, content, author_id, created_at, comment, restored_from)
          VALUES (${cur.id}, ${rev}, ${input.title}, ${input.content}, ${input.userId}, ${t},
                  ${input.comment || null}, ${input.restoredFrom ?? null})`,
    );
    await saveLinks(cur.id, input.content);
    return (await getPageById(cur.id))!;
  });
  publish({ type: "page.updated", slug: page.slug, title: page.title, rev: page.rev });
  return page;
}

/**
 * Puts an older version back as a NEW version on top (nothing in the history is overwritten or
 * lost, and the restore itself can be undone the same way). Title and text come from the old
 * version; the page stays where it is in the chapter tree.
 */
export async function restoreRevision(slug: string, rev: number, input: { expectedRev: number; userId: number }) {
  const cur = await getPage(slug);
  if (!cur) throw new HttpError(404, "Page not found.");
  const old = await getRevision(cur.id, rev);
  if (!old) throw new HttpError(404, "This version doesn’t exist.");
  if (old.title === cur.title && old.content === cur.content)
    throw new HttpError(409, "This version is identical to the current one.");
  return updatePage(slug, {
    title: old.title,
    content: old.content,
    parentId: cur.parent_id,
    expectedRev: input.expectedRev,
    userId: input.userId,
    restoredFrom: rev,
  });
}

export type RevisionRow = {
  rev: number;
  title: string;
  created_at: number;
  author: string | null;
  comment: string | null;
  restored_from: number | null;
  len: number;
};

/** Paged: 100 at a time, `before` = the oldest version number already shown. */
export const listRevisions = (pageId: number, before?: number, limit = 100) =>
  all<RevisionRow>(
    sql`SELECT r.rev, r.title, r.created_at, r.comment, r.restored_from, length(r.content) AS len,
          u.username AS author
        FROM page_revisions r LEFT JOIN users u ON u.id = r.author_id
        WHERE r.page_id = ${pageId} AND r.rev < ${before ?? Number.MAX_SAFE_INTEGER}
        ORDER BY r.rev DESC LIMIT ${limit}`,
  );

export const revisionCount = async (pageId: number) =>
  (await one<{ n: number }>(sql`SELECT COUNT(*) AS n FROM page_revisions WHERE page_id = ${pageId}`))?.n ?? 0;

export const getRevision = (pageId: number, rev: number) =>
  one<{
    rev: number;
    title: string;
    content: string;
    created_at: number;
    comment: string | null;
    restored_from: number | null;
  }>(
    sql`SELECT rev, title, content, created_at, comment, restored_from FROM page_revisions
        WHERE page_id = ${pageId} AND rev = ${rev}`,
  );

export async function breadcrumbs(page: PageRow): Promise<{ slug: string; title: string }[]> {
  if (!page.parent_id) return [];
  const rows = await all<{ slug: string; title: string }>(
    sql`WITH RECURSIVE up(id, slug, title, parent_id, d) AS (
          SELECT id, slug, title, parent_id, 1 FROM pages WHERE id = ${page.parent_id}
          UNION ALL SELECT p.id, p.slug, p.title, p.parent_id, up.d + 1 FROM pages p JOIN up ON p.id = up.parent_id
          WHERE up.d < 10
        ) SELECT slug, title FROM up ORDER BY d DESC`,
  );
  return rows;
}

export const pageCount = async () => (await one<{ n: number }>(sql`SELECT COUNT(*) AS n FROM pages`))?.n ?? 0;

/** Chapters a page may be filed under (nesting is capped, and a page can't become its own child). */
export function parentOptions(
  nodes: TreeNode[],
  excludeId?: number,
  depth = 0,
): { id: number; title: string; depth: number }[] {
  return nodes.flatMap((n) =>
    n.id === excludeId || depth > 1
      ? []
      : [{ id: n.id, title: n.title, depth }, ...parentOptions(n.children, excludeId, depth + 1)],
  );
}
