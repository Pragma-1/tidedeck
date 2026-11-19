import Link from "next/link";
import { FileText, Search as SearchIcon } from "lucide-react";
import { Shell } from "@/components/shell";
import { gate } from "@/lib/guard";
import { search, MAX_QUERY, type SearchResult } from "@/lib/search";
import { Segments } from "@/components/segments";
import { Notice } from "@/components/ui";
import { consume } from "@/lib/rate-limit";
import { getT } from "@/lib/i18n-server";
import { getCurrentUser } from "@/lib/session-cookie";
import { headers } from "next/headers";
import { clientIp } from "@/lib/net";
import { HttpError } from "@/lib/validate";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: (await getT())("Search") };
}

const LIMIT = 200;

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await gate("read");
  const raw = (await searchParams).q;
  const q = (typeof raw === "string" ? raw : "").slice(0, MAX_QUERY);
  const t = await getT();
  let result: SearchResult | null = null;
  let error: string | null = null;
  if (q.trim()) {
    const user = await getCurrentUser();
    const ip = clientIp(await headers());
    const bucket = user ? `search:u:${user.id}` : `search:${ip ?? "any"}`;
    if (!(await consume(bucket, user || ip ? 240 : 3000, 60))) error = t("Slow down a little.");
    else {
      try {
        result = await search(q, { limit: LIMIT, budgetMs: 800 });
      } catch (e) {
        if (e instanceof HttpError) error = t(e.message);
        else throw e;
      }
    }
  }
  return (
    <Shell>
      <h1 style={{ marginTop: 0 }}>{t("Search")}</h1>
      <form className="search-page-form" role="search" action="/search" method="get">
        <SearchIcon size={18} aria-hidden />
        <label className="sr-only" htmlFor="sq">
          {t("Search the wiki")}
        </label>
        <input
          id="sq"
          name="q"
          type="search"
          defaultValue={q}
          maxLength={MAX_QUERY}
          placeholder={t("Search pages")}
          autoComplete="off"
        />
        <button className="btn" type="submit">
          {t("Search")}
        </button>
      </form>
      <p className="hint search-help">
        {t(
          'Finds parts of words too: “te” also matches “Bitte”. Use * as a wildcard within a word (“wiki*”, “*ung”, “t*st”) and "quotes" for exact phrases.',
        )}
      </p>
      {error && <Notice kind="error">{error}</Notice>}
      {result && (
        <>
          <p className="hint" aria-live="polite">
            {result.total === 0
              ? t("No page matches “{q}”.", { q })
              : result.total === 1
                ? t("1 page matches “{q}”.", { q })
                : t("{n} pages match “{q}”.", { n: result.total, q })}
            {result.partial && <> {t("The search stopped early; refine your query for complete results.")}</>}
            {result.total > LIMIT && <> {t("Showing the best {n}.", { n: LIMIT })}</>}
          </p>
          <ul className="search-results">
            {result.hits.map((r) => (
              <li key={r.slug}>
                <Link href={`/w/${r.slug}`} className="sr-title">
                  <FileText size={16} aria-hidden />
                  <Segments segs={r.title} />
                </Link>
                <p className="sr-snip">
                  <Segments segs={r.snippet} />
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Shell>
  );
}
