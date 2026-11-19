import { api, json } from "@/lib/api";
import { search, MAX_QUERY } from "@/lib/search";
import { consume } from "@/lib/rate-limit";
import { HttpError } from "@/lib/validate";
export const dynamic = "force-dynamic";

// Search-as-you-type for the header search box. Results are plain/highlight segments, rendered as text.
export const GET = api(
  "public",
  async ({ req, ip, user }) => {
    const bucket = user ? `search:u:${user.id}` : `search:${ip ?? "any"}`;
    if (!(await consume(bucket, user || ip ? 240 : 3000, 60))) throw new HttpError(429, "Slow down a little.");
    const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, MAX_QUERY);
    if (!q.trim()) return json({ hits: [], total: 0, partial: false });
    const r = await search(q, { limit: 8, budgetMs: 200 });
    return json({
      hits: r.hits.map(({ slug, title, snippet }) => ({ slug, title, snippet })),
      total: r.total,
      partial: r.partial,
    });
  },
  { readGate: true },
);
