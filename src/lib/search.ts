import MarkdownIt, { type Token } from "markdown-it";
import { all, one, run, sql, tx, type Sql } from "./db";
import { HttpError } from "./validate";

/*
 * Full-text search with substring matching ("te" finds "Bitte") and * wildcards.
 *
 *  - Text is folded (lower case, accents removed, ß → ss) both when indexing and when querying,
 *    so "fur" finds "für" and "STRASSE" finds "Straße".
 *  - PostgreSQL trigram (pg_trgm) indexes narrow the candidates; the exact check runs in JavaScript.
 *  - Wildcards are matched with a plain left-to-right scan (no regular expressions built from
 *    user input), so no query can trigger catastrophic backtracking.
 *  - Every search runs against a time budget, and a global CPU budget caps what a flood of
 *    searches can cost the server.
 */

/* ------------------------------------------------------------------ folding */

const foldChar = (ch: string): string => {
  const c = ch.charCodeAt(0);
  if (c < 128) return c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : ch;
  let s = ch
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "");
  if (s.includes("ß")) s = s.replace(/ß/g, "ss");
  if (s.includes("ς")) s = s.replace(/ς/g, "σ");
  return s;
};

/** Folds a string; identical output to foldWithMap(s).text. */
export function fold(s: string): string {
  let out = "";
  for (const ch of s) out += foldChar(ch);
  return out;
}

/** Folds a string and remembers, for every folded UTF-16 unit, where it came from in the original. */
function foldWithMap(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = foldChar(ch);
    text += f;
    for (let k = 0; k < f.length; k++) map.push(i);
    i += ch.length;
  }
  map.push(i);
  return { text, map };
}

/* ------------------------------------------------------- markdown → plain */

const md = new MarkdownIt({ html: false, linkify: false });

function inlineText(children: Token[] | null): string {
  let s = "";
  for (const c of children ?? []) {
    if (c.type === "text" || c.type === "code_inline") s += c.content;
    else if (c.type === "softbreak" || c.type === "hardbreak") s += " ";
    else if (c.type === "image") s += inlineText(c.children);
  }
  return s;
}

/** Readable text of a Markdown page, as a reader sees it (no URLs, no syntax). */
export function markdownToPlain(src: string): string {
  const out: string[] = [];
  for (const t of md.parse(src, {})) {
    if (t.type === "inline") out.push(inlineText(t.children));
    else if (t.type === "fence" || t.type === "code_block") out.push(t.content);
  }
  return out
    .join("\n")
    .replace(/\[\[([^\]|\n]{1,160})(?:\|([^\]\n]{0,160}))?\]\]/g, (_m, a: string, b?: string) => (b || a).trim()) // [[Page|label]]
    .replace(/\[!(?:info|tip|warning|danger)\]\s*/gi, "") // callout markers
    .replace(/(^|\s)@(?=\S)/g, "$1") // leftovers of the @[title](url) media syntax
    .replace(/[ \t]+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------- index */

const MAX_PLAIN = 600_000;

/**
 * Brings the index up to date for every page written since the last search (marked by triggers).
 * Batches are claimed with SKIP LOCKED, so two searches running at once never index a page twice.
 */
export async function flushIndex() {
  if (!(await one(sql`SELECT 1 FROM search_dirty LIMIT 1`))) return;
  for (let guard = 0; guard < 10_000; guard++) {
    const n = await tx(async () => {
      const batch = await all<{ id: number; title: string; content: string }>(
        sql`SELECT p.id, p.title, p.content FROM search_dirty d JOIN pages p ON p.id = d.page_id
            ORDER BY d.page_id LIMIT 50 FOR UPDATE OF d SKIP LOCKED`,
      );
      for (const p of batch) {
        const plain = markdownToPlain(p.content).slice(0, MAX_PLAIN);
        await run(
          sql`INSERT INTO search_idx(page_id, title, body, plain) VALUES (${p.id}, ${fold(p.title)}, ${fold(plain)}, ${plain})
              ON CONFLICT (page_id) DO UPDATE SET title = excluded.title, body = excluded.body, plain = excluded.plain`,
        );
        await run(sql`DELETE FROM search_dirty WHERE page_id = ${p.id}`);
      }
      return batch.length;
    });
    if (!n) break;
  }
}

/** Marks every page for re-indexing (after a restore or import). */
export async function reindexAll() {
  await run(sql`INSERT INTO search_dirty(page_id) SELECT id FROM pages ON CONFLICT DO NOTHING`);
}

/* ------------------------------------------------------------------- query */

type Term = { phrase: boolean; glob: boolean; parts: string[]; anchorStart: boolean; anchorEnd: boolean; text: string };

const MAX_TERMS = 8;
const MAX_TERM_LEN = 64;
export const MAX_QUERY = 200;

/** Splits the query into terms: "quoted phrases", words, and words with * wildcards. */
export function parseQuery(q: string): Term[] {
  const src = q.slice(0, MAX_QUERY).replace(/[\u0000-\u001f\u007f]/g, " ");
  const terms: Term[] = [];
  for (const m of src.matchAll(/"([^"]*)"|(\S+)/g)) {
    if (terms.length >= MAX_TERMS) break;
    if (m[1] !== undefined) {
      const text = fold(m[1].trim().replace(/\s+/g, " ")).slice(0, MAX_TERM_LEN);
      if (text) terms.push({ phrase: true, glob: false, parts: [text], anchorStart: false, anchorEnd: false, text });
      continue;
    }
    const raw = fold(m[2].replace(/\*+/g, "*")).slice(0, MAX_TERM_LEN);
    if (!raw.replace(/\*/g, "")) continue; // a lone "*" says nothing
    if (!raw.includes("*")) {
      terms.push({ phrase: false, glob: false, parts: [raw], anchorStart: false, anchorEnd: false, text: raw });
      continue;
    }
    terms.push({
      phrase: false,
      glob: true,
      parts: raw.split("*").filter(Boolean),
      anchorStart: !raw.startsWith("*"),
      anchorEnd: !raw.endsWith("*"),
      text: raw,
    });
  }
  return terms;
}

/** Glob match of one word against literal parts separated by *. Linear scans, no backtracking needed. */
export function globMatch(word: string, t: Pick<Term, "parts" | "anchorStart" | "anchorEnd">): boolean {
  let pos = 0;
  const n = t.parts.length;
  for (let i = 0; i < n; i++) {
    const seg = t.parts[i];
    if (i === 0 && t.anchorStart) {
      if (!word.startsWith(seg)) return false;
      pos = seg.length;
      if (n === 1 && t.anchorEnd) return pos === word.length;
      continue;
    }
    if (i === n - 1 && t.anchorEnd) return word.length - seg.length >= pos && word.endsWith(seg);
    const at = word.indexOf(seg, pos);
    if (at < 0) return false;
    pos = at + seg.length;
  }
  return true;
}

const WORD_TRIM = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** Calls fn(start, end) for every whitespace-separated word (punctuation trimmed) of a folded text. */
function eachWord(text: string, fn: (start: number, end: number, word: string) => boolean | void, deadline: number) {
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if ((++n & 1023) === 0 && performance.now() > deadline) return;
    const raw = m[0];
    const word = raw.replace(WORD_TRIM, "");
    if (!word) continue;
    const lead = raw.indexOf(word);
    if (fn(m.index + lead, m.index + lead + word.length, word) === false) return;
  }
}

/** Occurrence count of one term in a folded text (capped). */
function countHits(text: string, t: Term, cap: number, deadline: number): number {
  let n = 0;
  if (!t.glob) {
    const s = t.parts[0];
    for (let at = text.indexOf(s); at >= 0 && n < cap; at = text.indexOf(s, at + s.length)) n++;
    return n;
  }
  // Cheap reject: every literal part has to occur somewhere first.
  if (!t.parts.every((p) => text.includes(p))) return 0;
  eachWord(
    text,
    (_s, _e, w) => {
      if (globMatch(w, t) && ++n >= cap) return false;
    },
    deadline,
  );
  return n;
}

/** Ranges [start, end) of hits in a folded text, for highlighting. */
function hitRanges(text: string, terms: Term[], limitTo: number, deadline: number): [number, number][] {
  const out: [number, number][] = [];
  const hay = text.slice(0, limitTo);
  for (const t of terms) {
    if (!t.glob) {
      const s = t.parts[0];
      for (let at = hay.indexOf(s), k = 0; at >= 0 && k < 200; at = hay.indexOf(s, at + s.length), k++)
        out.push([at, at + s.length]);
    } else {
      let k = 0;
      eachWord(
        hay,
        (st, en, w) => {
          if (globMatch(w, t)) {
            out.push([st, en]);
            if (++k >= 200) return false;
          }
        },
        deadline,
      );
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

export type Segment = { t: string; hit?: true };

/** Splits an original string into plain and highlighted segments. */
function highlight(original: string, terms: Term[], deadline: number, window?: number): Segment[] {
  const SNIP_SCAN = 120_000;
  const src = original.slice(0, SNIP_SCAN);
  const { text, map } = foldWithMap(src);
  const ranges = hitRanges(text, terms, text.length, deadline);
  let from = 0,
    to = src.length;
  if (window !== undefined) {
    const first = ranges.length ? map[ranges[0][0]] : 0;
    from = Math.max(0, first - Math.floor(window / 3));
    to = Math.min(src.length, from + window);
    // don't cut words in half
    if (from > 0) {
      const sp = src.indexOf(" ", from);
      if (sp >= 0 && sp - from < 20) from = sp + 1;
    }
    if (to < src.length) {
      const sp = src.lastIndexOf(" ", to);
      if (sp > from && to - sp < 20) to = sp;
    }
  }
  const segs: Segment[] = [];
  let cur = from;
  for (const [a, b] of ranges) {
    const s = map[a],
      e = map[b];
    if (e <= cur || s >= to) continue;
    const s2 = Math.max(s, cur),
      e2 = Math.min(e, to);
    if (s2 > cur) segs.push({ t: src.slice(cur, s2) });
    segs.push({ t: src.slice(s2, e2), hit: true });
    cur = e2;
  }
  if (cur < to) segs.push({ t: src.slice(cur, to) });
  if (window !== undefined) {
    if (from > 0) segs.unshift({ t: "… " });
    if (to < original.length) segs.push({ t: " …" });
  }
  return segs;
}

/* ------------------------------------------------------------- cpu budget */

const CPU_WINDOW_MS = 60_000;
const CPU_BUDGET_MS = 15_000; // all searches together may use at most 25 % of one core
let cpuStart = 0,
  cpuUsed = 0;
function chargeCpu(ms: number) {
  const t = Date.now();
  if (t - cpuStart > CPU_WINDOW_MS) {
    cpuStart = t;
    cpuUsed = 0;
  }
  cpuUsed += ms;
}
const cpuExhausted = () => Date.now() - cpuStart <= CPU_WINDOW_MS && cpuUsed >= CPU_BUDGET_MS;

/* ------------------------------------------------------------------ search */

export type SearchHit = { slug: string; title: Segment[]; snippet: Segment[]; score: number };
export type SearchResult = { hits: SearchHit[]; total: number; partial: boolean };

const likeArg = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const MAX_CANDIDATES = 3000;

export async function search(q: string, opts: { limit?: number; budgetMs?: number } = {}): Promise<SearchResult> {
  const terms = parseQuery(q);
  if (!terms.length) return { hits: [], total: 0, partial: false };
  if (cpuExhausted()) throw new HttpError(503, "Search is busy right now. Try again in a moment.");
  const started = performance.now();
  const deadline = started + (opts.budgetMs ?? 350);
  try {
    await flushIndex();
    // Every term must appear in title or text; the longest literal part of each term goes to the
    // trigram index (LIKE '%…%' is answered from it). Wildcards are checked exactly afterwards.
    const where: Sql[] = terms.map((t) => {
      const longest = t.parts.reduce((a, b) => ([...b].length > [...a].length ? b : a), "");
      const l = likeArg(longest);
      return sql`(title LIKE ${l} OR body LIKE ${l})`;
    });
    const ids = (
      await all<{ id: number }>(
        sql`SELECT page_id AS id FROM search_idx WHERE ${sql.join(where, sql` AND `)} LIMIT ${MAX_CANDIDATES}`,
      )
    ).map((r) => r.id);

    const scored: { id: number; score: number }[] = [];
    let partial = ids.length >= MAX_CANDIDATES;
    // fetched in small batches: 3000 candidates × large pages must never be in memory at once
    outer: for (let i = 0; i < ids.length; i += 25) {
      if (performance.now() > deadline) {
        partial = true;
        break;
      }
      const rows = await all<{ id: number; title: string; body: string }>(
        sql`SELECT page_id AS id, title, body FROM search_idx WHERE page_id = ANY(${ids.slice(i, i + 25)}::bigint[])`,
      );
      for (const r of rows) {
        if (performance.now() > deadline) {
          partial = true;
          break outer;
        }
        let score = 0;
        let ok = true;
        for (const t of terms) {
          const inTitle = countHits(r.title, t, 5, deadline);
          const inBody = countHits(r.body, t, 50, deadline);
          if (inTitle + inBody === 0) {
            ok = false;
            break;
          }
          score +=
            inTitle * 20 +
            Math.min(inBody, 50) +
            (r.title === t.text ? 50 : 0) +
            (!t.glob && r.title.startsWith(t.parts[0]) ? 10 : 0);
        }
        if (ok) scored.push({ id: r.id, score });
      }
    }
    scored.sort((a, b) => b.score - a.score || a.id - b.id);
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 500);
    const top = scored.slice(0, limit);
    const pages = new Map(
      (
        await all<{ id: number; slug: string; title: string; plain: string }>(
          sql`SELECT p.id, p.slug, p.title, left(s.plain, 120000) AS plain FROM pages p JOIN search_idx s ON s.page_id = p.id
              WHERE p.id = ANY(${top.map((x) => x.id)}::bigint[])`,
        )
      ).map((p) => [p.id, p]),
    );
    const hits: SearchHit[] = [];
    for (const { id, score } of top) {
      const p = pages.get(id);
      if (!p) continue;
      const late = performance.now() > deadline + 150;
      hits.push({
        slug: p.slug,
        score,
        title: late ? [{ t: p.title }] : highlight(p.title, terms, deadline + 150),
        snippet: late ? [{ t: p.plain.slice(0, 160) }] : highlight(p.plain, terms, deadline + 150, 180),
      });
    }
    return { hits, total: scored.length, partial };
  } finally {
    chargeCpu(performance.now() - started);
  }
}
