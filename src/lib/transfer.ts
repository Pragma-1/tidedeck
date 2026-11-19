import { waitForDrain } from "./stream-util";
import {
  createWriteStream,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  rmSync,
  writeFileSync,
  renameSync,
  readFileSync,
  statSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { all, one, run, sql, tx, now } from "./db";
import { LIMITS as APP } from "./config";
import { getPage, getTree, createPage, updatePage, type TreeNode } from "./pages";
import { LIMITS as MEDIA, MEDIA_DIR, sniff, stripImage, type MediaRow } from "./media";
import { HttpError, slugify } from "./validate";

/* ============================================================ front matter */

export { parseFrontMatter, toMarkdownFile } from "./frontmatter";
import { parseFrontMatter, toMarkdownFile } from "./frontmatter";

const cleanTitle = (s: string) =>
  s
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, APP.titleChars);
const firstHeading = (md: string) => /^#\s+(.+)$/m.exec(md)?.[1]?.trim() ?? null;
const prettify = (seg: string) => {
  const s = seg
    .replace(/\.(md|markdown)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Untitled";
};

/* ================================================================ export */

/** Folder layout: leaf pages are `slug.md`, pages with children are `slug/index.md`; media in `_media/`. */
function exportPaths(nodes: TreeNode[], prefix = ""): { id: number; path: string }[] {
  return nodes.flatMap((n) =>
    n.children.length
      ? [{ id: n.id, path: `${prefix}${n.slug}/index.md` }, ...exportPaths(n.children, `${prefix}${n.slug}/`)]
      : [{ id: n.id, path: `${prefix}${n.slug}.md` }],
  );
}

/** Streams the whole wiki as a ZIP. Pull-based, so memory stays flat no matter how big the media folder is. */
export function exportWikiZip(): ReadableStream<Uint8Array> {
  let pullWaiter: (() => void) | null = null;
  let cancelled = false;
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>(
    {
      start(c) {
        ctrl = c;
      },
      pull() {
        pullWaiter?.();
        pullWaiter = null;
      },
      cancel() {
        cancelled = true;
        pullWaiter?.();
      },
    },
    { highWaterMark: 8 },
  );
  const drained = async () => {
    while (!cancelled && (ctrl.desiredSize ?? 1) <= 0)
      await new Promise<void>((r) => {
        pullWaiter = r;
      });
  };

  const zip = new Zip((err, chunk, final) => {
    if (cancelled) return;
    if (err) {
      ctrl.error(err);
      return;
    }
    ctrl.enqueue(chunk);
    if (final) ctrl.close();
  });
  const addText = (name: string, text: string) => {
    const f = new ZipDeflate(name, { level: 6 });
    zip.add(f);
    f.push(new TextEncoder().encode(text), true);
  };

  void (async () => {
    try {
      const paths = exportPaths(await getTree());
      const pages = await all<{ id: number; slug: string; title: string; content: string; updated_at: number }>(
        sql`SELECT id, slug, title, content, updated_at FROM pages`,
      );
      const byId = new Map(pages.map((p) => [p.id, p]));
      const media = await all<Pick<MediaRow, "name" | "original_name" | "mime">>(
        sql`SELECT name, original_name, mime FROM media ORDER BY id`,
      );
      addText(
        "tidewiki.json",
        JSON.stringify(
          {
            format: "tidewiki-export",
            version: 1,
            exported_at: new Date().toISOString(),
            pages: paths.map((p) => ({ path: p.path, slug: byId.get(p.id)!.slug, title: byId.get(p.id)!.title })),
            media: media.map((m) => ({ name: m.name, original_name: m.original_name, mime: m.mime })),
          },
          null,
          2,
        ),
      );
      for (const p of paths) {
        if (cancelled) return;
        const page = byId.get(p.id)!;
        addText(p.path, toMarkdownFile(page.title, page.content));
        await drained();
      }
      for (const m of media) {
        const file = path.join(/* turbopackIgnore: true */ MEDIA_DIR(), m.name);
        if (!existsSync(file)) continue;
        const entry = new ZipPassThrough(`_media/${m.name}`); // images/videos are already compressed
        zip.add(entry);
        const fh = await open(file, "r");
        try {
          const buf = Buffer.alloc(256 * 1024);
          for (;;) {
            if (cancelled) return;
            const { bytesRead } = await fh.read(buf, 0, buf.length, null);
            entry.push(new Uint8Array(buf.subarray(0, bytesRead)), bytesRead === 0);
            if (bytesRead === 0) break;
            await drained();
          }
        } finally {
          await fh.close();
        }
      }
      zip.end();
    } catch (e) {
      if (!cancelled) ctrl.error(e);
    }
  })();
  return stream;
}

/* ================================================================ import */

export const IMPORT_LIMITS = {
  upload: (Number.parseInt(process.env.WIKI_MAX_IMPORT_MB || "", 10) || 1024) * 1024 * 1024,
  entries: 5000,
  markdownTotal: 100 * 1024 * 1024,
  uncompressedTotal: 4 * 1024 * 1024 * 1024,
};
export type Conflict = "skip" | "overwrite" | "copy";
export type PlanItem = {
  /** stable id of the page inside this archive (folder path without extension) */
  key: string;
  path: string;
  title: string;
  slug: string;
  /** chapter title, for display */
  parent: string | null;
  /** chapter inside the archive, or null (top level or an existing page, see parentPage) */
  parentKey: string | null;
  /** an existing wiki page the page goes under */
  parentPage: number | null;
  action: "create" | "overwrite" | "skip" | "copy";
  /** a page with this address exists already (its level, 1 = top) */
  exists: boolean;
  existingDepth: number | null;
};

/**
 * How the person arranged the preview: every page of the archive exactly once, in the order
 * wanted. parent = null (top level), the key of another page in the archive, or "page:<id>" for
 * an existing wiki page. include = false leaves the page out (its sub-pages move up a level).
 */
export type LayoutItem = { key: string; parent: string | null; title?: string; include: boolean };
export type ImportResult = {
  pages: PlanItem[];
  media: number;
  mediaReused: number;
  warnings: string[];
  created: number;
  updated: number;
  skipped: number;
  /** pages left out in the arrangement */
  excluded: number;
};

const IMPORT_DIR = () => path.join(/* turbopackIgnore: true */ MEDIA_DIR(), ".import");

/* ------------------------------------------------------------ staged uploads */

/**
 * A previewed upload waits here so the import can be applied with the arrangement made in the
 * preview, without sending the file again. Bound to the person who uploaded it, one per person,
 * gone after an hour, after it was imported, or when the server restarts. Kept on globalThis so
 * every route of the server sees the same list.
 */
type Staged = { userId: number; file: string; name: string; expires: number };
const STAGE_TTL_MS = 60 * 60 * 1000;
const gs = globalThis as unknown as { __wikiStaged?: Map<string, Staged>; __wikiStagedSwept?: boolean };
const stagedMap = () => (gs.__wikiStaged ??= new Map());
const STAGE_TOKEN = /^[A-Za-z0-9_-]{32}$/;

function sweepStaged() {
  const m = stagedMap();
  for (const [t, v] of m) if (v.expires < Date.now()) dropStaged(t);
  if (!gs.__wikiStagedSwept) {
    // leftovers of an earlier run of the server can never be applied: remove them
    gs.__wikiStagedSwept = true;
    const known = new Set([...m.values()].map((v) => path.basename(v.file)));
    try {
      for (const f of readdirSync(IMPORT_DIR()))
        if (f.startsWith("staged-") && !known.has(f))
          rmSync(path.join(/* turbopackIgnore: true */ IMPORT_DIR(), f), { force: true });
    } catch {
      /* no folder yet */
    }
  }
}

/** Keeps an uploaded file for applying later; returns the token. The person's older preview is dropped. */
export function stageUpload(file: string, userId: number, name: string): string {
  sweepStaged();
  const m = stagedMap();
  for (const [t, v] of m) if (v.userId === userId) dropStaged(t);
  const token = randomBytes(24).toString("base64url");
  const dest = path.join(/* turbopackIgnore: true */ IMPORT_DIR(), `staged-${randomBytes(12).toString("hex")}`);
  renameSync(file, dest);
  m.set(token, { userId, file: dest, name, expires: Date.now() + STAGE_TTL_MS });
  return token;
}

/** The staged file for this token — only for the person who uploaded it. */
export function stagedUpload(token: unknown, userId: number): { file: string; name: string } {
  sweepStaged();
  const v = typeof token === "string" && STAGE_TOKEN.test(token) ? stagedMap().get(token) : undefined;
  if (!v || v.userId !== userId || !existsSync(v.file))
    throw new HttpError(410, "This preview has expired. Check the file again.");
  return { file: v.file, name: v.name };
}

export function dropStaged(token: string) {
  const m = stagedMap();
  const v = m.get(token);
  if (!v) return;
  m.delete(token);
  rmSync(v.file, { force: true });
}

/** Streams the request body into a temp file with a hard cap. */
export async function receiveUpload(
  body: ReadableStream<Uint8Array>,
  declared: number,
  opts: { cap?: number; dir?: string } = {},
): Promise<string> {
  const cap = opts.cap ?? IMPORT_LIMITS.upload;
  const dir = opts.dir ?? IMPORT_DIR();
  if (declared > cap) throw new HttpError(413, "This file is too large.");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(/* turbopackIgnore: true */ dir, `upload-${randomBytes(9).toString("hex")}`);
  const out = createWriteStream(file, { mode: 0o600 });
  let failed: Error | null = null;
  out.on("error", (e) => {
    failed = e;
  });
  const reader = body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) throw new HttpError(413, "This file is too large.");
      if (failed) throw new HttpError(500, "Something went wrong on the server.");
      if (!out.write(value)) await waitForDrain(out);
    }
    await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));
    if (size === 0) throw new HttpError(400, "Empty request.");
    return file;
  } catch (e) {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    out.destroy();
    rmSync(file, { force: true });
    throw e;
  }
}

type Entry = { path: string; kind: "md" | "media"; data?: Buffer; tmp?: string; size: number };

/** Archive paths are only ever *names* here — nothing is written to disk under them, so zip-slip can't happen. */
function normalizeEntry(raw: string): { path: string; kind: "md" | "media" } | { skip: string } {
  const p = raw.replace(/\\/g, "/").replace(/^\.\//, "");
  if (/[\u0000-\u001f\u007f]/.test(p) || p.length > 400) return { skip: "invalid name" };
  if (p.endsWith("/") || p === "tidewiki.json") return { skip: "folder" }; // folders and our own manifest: silently ignored
  const segs = p.split("/");
  if (segs.some((s) => s === "" || s === "." || s === "..") || p.startsWith("/")) return { skip: "unsafe path" };
  if (segs.some((s) => s.startsWith(".") || s === "__MACOSX")) return { skip: "hidden file" };
  if (
    segs[0] === "_media" &&
    segs.length === 2 &&
    /^[\w.-]{1,120}\.(png|jpe?g|gif|webp|mp4|webm|ogv|mov)$/i.test(segs[1])
  )
    return { path: p, kind: "media" };
  if (/\.(md|markdown)$/i.test(p)) return { path: p, kind: "md" };
  return { skip: "unsupported file type" };
}

/** Decompresses a ZIP with every limit enforced *while* inflating (zip bombs stop at the cap, not after). */
async function readZip(file: string, wantMedia: boolean, warnings: string[]): Promise<Entry[]> {
  mkdirSync(IMPORT_DIR(), { recursive: true, mode: 0o700 });
  const entries: Entry[] = [];
  let count = 0,
    total = 0,
    mdTotal = 0,
    fatal: Error | null = null;
  const pending = new Set<Promise<void>>();
  const unzip = new Unzip((f) => {
    if (fatal) return;
    if (++count > IMPORT_LIMITS.entries) {
      fatal = new HttpError(413, "The archive has too many files.");
      return;
    }
    const n = normalizeEntry(f.name);
    if ("skip" in n) {
      if (n.skip !== "folder" && n.skip !== "hidden file") warnings.push(`${f.name.slice(0, 120)}: ${n.skip}`);
      return;
    }
    const cap = n.kind === "md" ? APP.pageBytes : /\.(png|jpe?g|gif|webp)$/i.test(n.path) ? MEDIA.image : MEDIA.video;
    const e: Entry = { path: n.path, kind: n.kind, size: 0 };
    const chunks: Buffer[] = [];
    let ws: ReturnType<typeof createWriteStream> | null = null;
    if (n.kind === "media") {
      if (!wantMedia) {
        e.size = -1;
      } else {
        e.tmp = path.join(/* turbopackIgnore: true */ IMPORT_DIR(), `m-${randomBytes(9).toString("hex")}`);
        ws = createWriteStream(e.tmp, { mode: 0o600 });
        ws.on("error", () => {
          /* reported via size check below */
        });
      }
    }
    let over = false;
    const done = new Promise<void>((resolve) => {
      f.ondata = (err, data, final) => {
        if (err) {
          warnings.push(`${n.path}: ${err.message}`);
          over = true;
          ws?.destroy();
          resolve();
          return;
        }
        if (over) return;
        e.size += data.length;
        total += data.length;
        if (n.kind === "md") mdTotal += data.length;
        if (total > IMPORT_LIMITS.uncompressedTotal || mdTotal > IMPORT_LIMITS.markdownTotal) {
          fatal = new HttpError(413, "The archive unpacks to more data than allowed.");
          over = true;
          f.terminate();
          ws?.destroy();
          resolve();
          return;
        }
        if (e.size > cap) {
          warnings.push(`${n.path}: too large, skipped`);
          over = true;
          f.terminate();
          ws?.destroy();
          resolve();
          return;
        }
        if (n.kind === "md") chunks.push(Buffer.from(data));
        else ws?.write(data);
        if (final) {
          if (n.kind === "md") {
            e.data = Buffer.concat(chunks);
            entries.push(e);
            resolve();
          } else if (ws)
            ws.end(() => {
              entries.push(e);
              resolve();
            });
          else {
            entries.push(e);
            resolve();
          }
        }
      };
    });
    pending.add(done);
    try {
      f.start();
    } catch (err) {
      warnings.push(`${n.path}: ${(err as Error).message}`);
    }
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);

  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(256 * 1024);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      try {
        unzip.push(new Uint8Array(buf.subarray(0, n)), n === 0);
      } catch (err) {
        throw new HttpError(400, `This archive can’t be read: ${(err as Error).message.slice(0, 120)}`);
      }
      if (fatal) throw fatal;
      if (n === 0) break;
      await new Promise((r) => setImmediate(r)); // stay responsive for other requests
    }
  } finally {
    closeSync(fd);
  }
  await Promise.all(pending);
  if (fatal) throw fatal;
  return entries;
}

function decodeText(b: Buffer, name: string, warnings: string[]): string | null {
  if (b.includes(0)) {
    warnings.push(`${name}: not a text file, skipped`);
    return null;
  }
  const s = new TextDecoder("utf-8", { fatal: false }).decode(b);
  if (s.includes("�")) warnings.push(`${name}: contained invalid UTF-8 characters (replaced)`);
  return s;
}

/** A page of the archive while the import is planned. */
type Node = {
  key: string;
  title: string;
  slug: string;
  content: string;
  parentKey: string | null;
  parentPage: number | null;
  depth: number;
  path: string;
};

const LAYOUT_BAD = "The arrangement doesn’t match the file. Check the file again.";

/**
 * Checks the arrangement the person made in the preview and turns it into the creation order
 * (parents before their sub-pages, siblings in the chosen order). Everything coming from the
 * browser is checked: every page exactly once, chapters only pages of this archive or existing
 * wiki pages, no loops, the nesting limit kept. Pages left out hand their sub-pages to their
 * own chapter. Pages that are kept as they are (an existing page, "skip") stay where they are
 * in the wiki, so their depth there counts.
 */
async function arrange(
  nodes: Map<string, Node>,
  layout: unknown,
  actionOf: Map<string, PlanItem["action"]>,
  existsFor: Map<string, boolean>,
  existing: Map<string, { id: number; depth: number }>,
): Promise<{ ordered: Node[]; pageTitles: Map<number, string> }> {
  if (!Array.isArray(layout) || layout.length !== nodes.size) throw new HttpError(400, LAYOUT_BAD);
  type It = { node: Node; parentKey: string | null; parentPage: number | null; include: boolean; index: number };
  const items = new Map<string, It>();
  layout.forEach((raw: unknown, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, LAYOUT_BAD);
    const { key, parent, title, include } = raw as Record<string, unknown>;
    if (typeof key !== "string" || !nodes.has(key) || items.has(key) || typeof include !== "boolean")
      throw new HttpError(400, LAYOUT_BAD);
    let parentKey: string | null = null;
    let parentPage: number | null = null;
    if (parent === null) {
      /* top level */
    } else if (typeof parent === "string" && /^page:[1-9]\d{0,15}$/.test(parent)) {
      parentPage = Number(parent.slice(5));
      if (!Number.isSafeInteger(parentPage)) throw new HttpError(400, LAYOUT_BAD);
    } else if (typeof parent === "string" && parent !== key && nodes.has(parent)) parentKey = parent;
    else throw new HttpError(400, LAYOUT_BAD);
    const node = nodes.get(key)!;
    if (title !== undefined) {
      if (typeof title !== "string" || title.length > 1000) throw new HttpError(400, LAYOUT_BAD);
      const t = cleanTitle(title);
      if (t) node.title = t;
    }
    items.set(key, { node, parentKey, parentPage, include, index });
  });

  // no loops: following the chapters upwards must end at the top or at an existing page
  for (const it of items.values()) {
    const seen = new Set<string>([it.node.key]);
    for (let k = it.parentKey; k; k = items.get(k)!.parentKey) {
      if (seen.has(k)) throw new HttpError(400, "A page can’t be moved inside itself.");
      seen.add(k);
    }
  }
  // left-out chapters hand their sub-pages up
  for (const it of items.values()) {
    while (it.parentKey && !items.get(it.parentKey)!.include) {
      const up = items.get(it.parentKey)!;
      it.parentKey = up.parentKey;
      it.parentPage = up.parentPage;
    }
    if (it.parentKey) it.parentPage = null;
  }
  const kept = [...items.values()].filter((it) => it.include);

  // existing pages used as chapters must exist; their level decides how deep the import may go
  const pageIds = [...new Set(kept.map((it) => it.parentPage).filter((x): x is number => x !== null))];
  const pages = new Map<number, { title: string; depth: number }>();
  if (pageIds.length) {
    for (const r of await all<{ id: number; title: string; depth: number }>(
      sql`WITH RECURSIVE up(id, cur, d) AS (
            SELECT id, parent_id, 1 FROM pages WHERE id = ANY(${pageIds}::bigint[])
            UNION ALL SELECT up.id, p.parent_id, up.d + 1 FROM up JOIN pages p ON p.id = up.cur WHERE up.d < 50
          )
          SELECT p.id, p.title, MAX(up.d) AS depth FROM up JOIN pages p ON p.id = up.id GROUP BY p.id, p.title`,
    ))
      pages.set(r.id, { title: r.title, depth: r.depth });
    if (pageIds.some((id) => !pages.has(id)))
      throw new HttpError(400, "The selected chapter does not exist.", "parentId");
  }
  const depth = new Map<string, number>();
  const depthOfItem = (it: It): number => {
    const known = depth.get(it.node.key);
    if (known !== undefined) return known;
    const stays = actionOf.get(it.node.key) === "skip" && existsFor.get(it.node.key);
    const d = stays
      ? existing.get(it.node.slug)!.depth
      : (it.parentPage ? pages.get(it.parentPage)!.depth : it.parentKey ? depthOfItem(items.get(it.parentKey)!) : 0) +
        1;
    depth.set(it.node.key, d);
    return d;
  };
  for (const it of kept)
    if (depthOfItem(it) > APP.maxPageDepth)
      throw new HttpError(400, `Chapters can be nested ${APP.maxPageDepth} levels deep at most.`, "parentId");

  // creation order: depth-first from the top, siblings as arranged
  const kids = new Map<string | null, It[]>();
  for (const it of kept) {
    const p = it.parentKey;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(it);
  }
  for (const list of kids.values()) list.sort((a, b) => a.index - b.index);
  const ordered: Node[] = [];
  const walk = (p: string | null) => {
    for (const it of kids.get(p) ?? []) {
      it.node.parentKey = it.parentKey;
      it.node.parentPage = it.parentPage;
      ordered.push(it.node);
      walk(it.node.key);
    }
  };
  walk(null);
  return { ordered, pageTitles: new Map([...pages].map(([id, v]) => [id, v.title])) };
}

/**
 * Imports a ZIP (wiki export or any folder of .md files) or a single .md file.
 * `apply=false` only plans and reports; nothing is written.
 */
export async function importArchive(
  file: string,
  opts: { apply: boolean; conflict: Conflict; userId: number; singleName?: string; layout?: unknown },
): Promise<ImportResult> {
  const warnings: string[] = [];
  const head = Buffer.alloc(4);
  const fd = openSync(file, "r");
  readSync(fd, head, 0, 4, 0);
  closeSync(fd);
  const isZip = head.readUInt32LE(0) === 0x04034b50 || head.readUInt32LE(0) === 0x06054b50;
  let entries: Entry[];
  if (isZip) entries = await readZip(file, opts.apply, warnings);
  else {
    if (statSync(file).size > APP.pageBytes) throw new HttpError(413, "This page is too large.");
    const name = (opts.singleName || "import.md").replace(/[^\w.\- ]/g, "").slice(0, 120) || "import.md";
    entries = [
      { path: /\.(md|markdown)$/i.test(name) ? name : `${name}.md`, kind: "md", data: readFileSync(file), size: 0 },
    ];
  }
  const tmpFiles = entries.map((e) => e.tmp).filter(Boolean) as string[];
  try {
    return await plan(entries, opts, warnings);
  } finally {
    for (const t of tmpFiles) rmSync(t, { force: true });
  }
}

async function plan(
  entries: Entry[],
  opts: { apply: boolean; conflict: Conflict; userId: number; layout?: unknown },
  warnings: string[],
): Promise<ImportResult> {
  // ---- pages: folder structure -> hierarchy
  const nodes = new Map<string, Node>();
  const keyOf = (p: string) => {
    const s = p.replace(/\.(md|markdown)$/i, "");
    return s.endsWith("/index") ? s.slice(0, -6) : s === "index" ? "" : s;
  };
  for (const e of entries.filter((x) => x.kind === "md").sort((a, b) => a.path.localeCompare(b.path))) {
    const text = decodeText(e.data!, e.path, warnings);
    if (text === null) continue;
    const key = keyOf(e.path);
    if (key === "") {
      warnings.push(`${e.path}: a root index page was imported as “Home”`);
    }
    const fm = parseFrontMatter(text);
    const seg = key.split("/").pop() || "home";
    const title = cleanTitle(fm.title ?? firstHeading(fm.body) ?? prettify(seg)) || "Untitled";
    nodes.set(key || "home", {
      key: key || "home",
      title,
      slug: slugify(seg),
      content: fm.body,
      parentKey: null,
      parentPage: null,
      depth: 0,
      path: e.path,
    });
  }
  // folders without an index page become empty chapter pages
  for (const n of [...nodes.values()]) {
    const segs = n.key.split("/");
    for (let i = 1; i < segs.length; i++) {
      const k = segs.slice(0, i).join("/");
      if (!nodes.has(k))
        nodes.set(k, {
          key: k,
          title: prettify(segs[i - 1]),
          slug: slugify(segs[i - 1]),
          content: "",
          parentKey: null,
          parentPage: null,
          depth: 0,
          path: `${k}/`,
        });
    }
  }
  for (const n of nodes.values()) {
    const segs = n.key.split("/");
    n.depth = segs.length;
    let parent: string | null = segs.length > 1 ? segs.slice(0, -1).join("/") : null;
    // the wiki nests at most LIMITS.maxPageDepth levels: deeper pages hang under the deepest allowed ancestor
    while (parent && parent.split("/").length >= APP.maxPageDepth) parent = parent.split("/").slice(0, -1).join("/");
    if (parent !== (segs.length > 1 ? segs.slice(0, -1).join("/") : null))
      warnings.push(`${n.path}: nested too deeply, placed under “${nodes.get(parent!)?.title}”`);
    n.parentKey = parent;
  }
  const defaultOrder = [...nodes.values()].sort(
    (a, b) => a.key.split("/").length - b.key.split("/").length || a.key.localeCompare(b.key),
  );
  if (defaultOrder.length > 2000) throw new HttpError(413, "The archive has too many files.");

  // ---- existing pages with the same address, and what happens to them
  const existing = new Map(
    (
      await all<{ slug: string; id: number; title: string; depth: number }>(
        sql`WITH RECURSIVE up(id, cur, d) AS (
              SELECT id, parent_id, 1 FROM pages WHERE slug = ANY(${defaultOrder.map((n) => n.slug)}::text[])
              UNION ALL SELECT up.id, p.parent_id, up.d + 1 FROM up JOIN pages p ON p.id = up.cur WHERE up.d < 50
            )
            SELECT p.slug, p.id, p.title, MAX(up.d) AS depth FROM up JOIN pages p ON p.id = up.id
            GROUP BY p.slug, p.id, p.title`,
      )
    ).map((r) => [r.slug, r]),
  );
  const claimed = new Set<string>(); // a slug used twice inside the archive must not "conflict" with itself
  const actionOf = new Map<string, PlanItem["action"]>();
  const existsFor = new Map<string, boolean>();
  for (const n of defaultOrder) {
    const ex = !claimed.has(n.slug) && existing.has(n.slug);
    claimed.add(n.slug);
    existsFor.set(n.key, ex);
    actionOf.set(
      n.key,
      !ex ? "create" : opts.conflict === "overwrite" ? "overwrite" : opts.conflict === "copy" ? "copy" : "skip",
    );
  }

  // ---- the order and chapters: the archive's folders, or how the person arranged them
  const arranged = opts.layout === undefined ? null : await arrange(nodes, opts.layout, actionOf, existsFor, existing);
  const ordered = arranged ? arranged.ordered : defaultOrder;
  const parentPageTitle = arranged?.pageTitles ?? new Map<number, string>();

  // ---- media: reuse identical names (re-import into the same wiki), otherwise store through the upload pipeline
  const mediaEntries = entries.filter((e) => e.kind === "media");
  const rename = new Map<string, string>();
  let mediaReused = 0;
  const stored: string[] = [];
  const planItems: PlanItem[] = ordered.map((n) => ({
    key: n.key,
    path: n.path,
    title: n.title,
    slug: n.slug,
    parent: n.parentKey
      ? nodes.get(n.parentKey)!.title
      : n.parentPage
        ? (parentPageTitle.get(n.parentPage) ?? null)
        : null,
    parentKey: n.parentKey,
    parentPage: n.parentPage,
    action: actionOf.get(n.key)!,
    exists: existsFor.get(n.key)!,
    existingDepth: existsFor.get(n.key) ? (existing.get(n.slug)?.depth ?? null) : null,
  }));
  const result: ImportResult = {
    pages: planItems,
    media: mediaEntries.length,
    mediaReused: 0,
    warnings,
    created: 0,
    updated: 0,
    skipped: planItems.filter((p) => p.action === "skip").length,
    excluded: nodes.size - ordered.length,
  };
  if (!opts.apply) return result;

  try {
    for (const e of mediaEntries) {
      const oldName = e.path.split("/")[1];
      if (await one(sql`SELECT 1 FROM media WHERE name = ${oldName}`)) {
        rename.set(oldName, oldName);
        mediaReused++;
        continue;
      }
      const buf = readFileSync(e.tmp!);
      const type = sniff(buf.subarray(0, 64));
      if (!type) {
        warnings.push(`${e.path}: not a supported image or video, skipped`);
        continue;
      }
      let data: Buffer;
      try {
        data = type.kind === "image" ? stripImage(buf, type.ext) : buf;
      } catch {
        warnings.push(`${e.path}: damaged file, skipped`);
        continue;
      }
      const name = `${randomBytes(16).toString("base64url")}.${type.ext}`;
      const dest = path.join(/* turbopackIgnore: true */ MEDIA_DIR(), name);
      writeFileSync(`${dest}.part`, data, { mode: 0o600 });
      renameSync(`${dest}.part`, dest);
      stored.push(dest);
      await run(
        sql`INSERT INTO media(name, mime, kind, size, original_name, created_by, created_at)
            VALUES (${name}, ${type.mime}, ${type.kind}, ${data.length}, ${oldName.slice(0, 120)}, ${opts.userId}, ${now()})`,
      );
      rename.set(oldName, name);
    }
    result.mediaReused = mediaReused;
    const fix = (md: string) =>
      md.replace(/\/media\/([A-Za-z0-9_-]{8,60}\.(?:png|jpe?g|gif|webp|mp4|webm|ogv|mov))/g, (m, n: string) =>
        rename.has(n) ? `/media/${rename.get(n)}` : m,
      );

    // ---- pages, all-or-nothing
    await tx(async () => {
      const idByKey = new Map<string, number>();
      result.created = result.updated = 0; // a retried transaction starts counting again
      for (let i = 0; i < ordered.length; i++) {
        const n = ordered[i];
        const item = planItems[i];
        const parentId = n.parentPage ?? (n.parentKey ? (idByKey.get(n.parentKey) ?? null) : null);
        const existing = item.action === "create" || item.action === "copy" ? undefined : await getPage(n.slug);
        if (item.action === "skip" && existing) {
          idByKey.set(n.key, existing.id);
          continue;
        }
        if (item.action === "overwrite" && existing) {
          const p = await updatePage(existing.slug, {
            title: n.title,
            content: fix(n.content),
            parentId: parentId === existing.id ? existing.parent_id : parentId,
            expectedRev: existing.rev,
            userId: opts.userId,
          });
          idByKey.set(n.key, p.id);
          result.updated++;
          continue;
        }
        const p = await createPage({
          title: n.title,
          content: fix(n.content),
          parentId,
          userId: opts.userId,
          slug: n.slug,
        });
        item.slug = p.slug;
        idByKey.set(n.key, p.id);
        result.created++;
      }
    });
    return result;
  } catch (e) {
    // roll back stored media too, so a failed import leaves nothing behind
    for (const f of stored) {
      rmSync(f, { force: true });
      await run(sql`DELETE FROM media WHERE name = ${path.basename(f)}`);
    }
    throw e;
  }
}
