// "Deleted" must mean gone: not just hidden in the wiki, but out of the database files and off the
// disk. These tests look at the raw PostgreSQL files and the media folder, not at the app.
import "./setup-env";
import { existsSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { withSuper } from "./pg-cluster.mjs";
import { addUser, db } from "./pg";
import { pendingWipes, ready, wipe } from "@/lib/db";
import { createPage, updatePage, getPage } from "@/lib/pages";
import { emptyTrash, listTrash, purgeOldTrash, purgeTrashItem, trashPage } from "@/lib/trash";
import { deleteMediaMany, deleteUnusedMedia, listMedia, MEDIA_DIR, storeUpload, sweepMediaDir } from "@/lib/media";
import { eraseUser } from "@/lib/admin";

const cluster = JSON.parse(process.env.TW_PG_CLUSTER!) as Parameters<typeof withSuper>[0] & { data: string };
const dbName = process.env.WIKI_DB_NAME!;

/** Every file of this database (tables, TOAST, indexes) after a checkpoint has written all pages out. */
async function dbFilesContain(marker: string): Promise<string[]> {
  const oid = await withSuper(cluster, "postgres", async (c) => {
    await c.query("CHECKPOINT");
    return (await c.query("SELECT oid FROM pg_database WHERE datname = $1", [dbName])).rows[0].oid as number;
  });
  const dir = path.join(cluster.data, "base", String(oid));
  const needle = Buffer.from(marker);
  return readdirSync(dir).filter((f) => {
    try {
      return readFileSync(path.join(dir, f)).includes(needle);
    } catch {
      return false; // a file removed while scanning
    }
  });
}

const fx = (n: string) => readFileSync(path.join(import.meta.dirname, "fixtures", n));
const stream = (b: Buffer) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(b));
      c.close();
    },
  });
/**
 * Waits until no wipe is outstanding. Something else in the database (here mostly PostgreSQL's
 * own ANALYZE) can hold an older snapshot for a moment; then the wipe says "not yet" and has to
 * run again — exactly what the app does on its own, just without waiting 30 s.
 */
async function settled() {
  for (let i = 0; i < 100; i++) {
    await wipe([]);
    if (!(await pendingWipes()).length) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`wipe never finished: ${JSON.stringify(await pendingWipes())}`);
}

const appClient = async () => {
  const env = process.env;
  const c = new pg.Client({
    host: env.WIKI_DB_HOST,
    port: Number(env.WIKI_DB_PORT),
    user: env.WIKI_DB_USER,
    password: env.WIKI_DB_PASSWORD,
    database: env.WIKI_DB_NAME,
  });
  await c.connect();
  return c;
};

const marker = (what: string) => `GONE-${what}-${Math.random().toString(36).slice(2, 10)}`;

describe("deleting for good", () => {
  it("a page purged from the trash leaves no trace in the database files (short and long text)", async () => {
    await ready();
    const uid = await addUser("wipe-a", "admin");
    const short = marker("SHORT");
    const long = marker("LONG");
    // the long text goes to TOAST storage (compressed, so make it incompressible around the marker)
    const noise = Array.from({ length: 3000 }, () => Math.random().toString(36).slice(2)).join(" ");
    const p = await createPage({
      title: "Wipe Seite",
      content: `${short}\n\n${noise}\n${long}`,
      parentId: null,
      userId: uid,
    });
    await updatePage(p.slug, {
      title: p.title,
      content: `zweite Fassung ${short}\n${noise}\n${long}`,
      parentId: null,
      expectedRev: p.rev,
      userId: uid,
    });
    expect((await dbFilesContain(short)).length).toBeGreaterThan(0); // the scan does find it
    await trashPage(p.slug, uid);
    expect((await dbFilesContain(short)).length).toBeGreaterThan(0); // in the trash: still there, on purpose
    const item = (await listTrash()).find((i) => i.slug === p.slug)!;
    await purgeTrashItem(item.id);
    await settled();
    expect(await dbFilesContain(short)).toEqual([]);
    expect(await dbFilesContain(long)).toEqual([]);
  });

  it("emptying the trash and the 30-day purge wipe too", async () => {
    const uid = await addUser("wipe-b", "admin");
    const a = marker("EMPTY");
    const b = marker("OLD");
    const pa = await createPage({ title: "Wipe leer", content: a, parentId: null, userId: uid });
    const pb = await createPage({ title: "Wipe alt", content: b, parentId: null, userId: uid });
    await trashPage(pa.slug, uid);
    await emptyTrash();
    await settled();
    expect(await dbFilesContain(a)).toEqual([]);
    await trashPage(pb.slug, uid);
    await db().prepare("UPDATE trash SET deleted_at = deleted_at - 31 * 86400").run();
    expect(await purgeOldTrash()).toBe(1);
    await settled();
    expect(await dbFilesContain(b)).toEqual([]);
  });

  it("an erased account leaves no trace of its name or address", async () => {
    const name = `gone${Math.random().toString(36).slice(2, 8)}`;
    const id = await addUser(name, "editor");
    expect((await dbFilesContain(`${name}@example.com`)).length).toBeGreaterThan(0);
    await eraseUser(id, "self");
    await settled();
    expect(await dbFilesContain(`${name}@example.com`)).toEqual([]);
  });

  it("while an older snapshot could still see the rows, the wipe isn't counted as done", async () => {
    const uid = await addUser("wipe-snap", "admin");
    const m = marker("SNAPSHOT");
    const pg1 = await createPage({ title: "Wipe Schnappschuss", content: m, parentId: null, userId: uid });
    await settled();
    // a long read elsewhere (like a backup in progress): it started before the deletion
    const reader = await appClient();
    try {
      await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await reader.query("SELECT 1");
      await trashPage(pg1.slug, uid);
      await emptyTrash();
      expect(await pendingWipes()).toEqual(expect.arrayContaining(["pages", "page_revisions"]));
      expect((await dbFilesContain(m)).length).toBeGreaterThan(0); // honestly not gone yet
      await reader.query("COMMIT");
    } finally {
      await reader.end();
    }
    await settled(); // the retry (30 s later in the app) finishes the job
    expect(await dbFilesContain(m)).toEqual([]);
  });

  it("a table that is busy is wiped later (the list survives restarts), never forgotten", async () => {
    await settled();
    const c = await appClient();
    try {
      await c.query("BEGIN");
      await c.query("LOCK TABLE media IN ACCESS SHARE MODE"); // someone reading, for longer than 2 s
      const t0 = Date.now();
      await wipe(["media"]);
      expect(Date.now() - t0).toBeLessThan(10_000); // gave up waiting instead of blocking everyone
      expect(await pendingWipes()).toContain("media");
      await c.query("COMMIT");
      await settled(); // the next run (or the hourly job) catches up
    } finally {
      await c.end();
    }
  });
});

describe("media: delete several, delete unused, and really gone", () => {
  const upload = async (name: string, uid: number) =>
    storeUpload(stream(fx("meta.png")), 0, name, uid).then((m) => ({ ...m, file: path.join(MEDIA_DIR(), m.name) }));

  it("deleting removes the file from the disk and the entry from the database files", async () => {
    const uid = await addUser("media-wipe", "admin");
    const secretName = marker("FILENAME");
    const a = await upload(`${secretName}.png`, uid);
    const b = await upload("b.png", uid);
    expect(existsSync(a.file) && existsSync(b.file)).toBe(true);
    expect((await dbFilesContain(secretName)).length).toBeGreaterThan(0);
    const gone = await deleteMediaMany([a.id, b.id], { id: uid, role: "admin" });
    expect(gone.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    expect(existsSync(a.file) || existsSync(b.file)).toBe(false);
    expect((await listMedia()).some((m) => m.id === a.id || m.id === b.id)).toBe(false);
    await settled();
    expect(await dbFilesContain(secretName)).toEqual([]);
  });

  it("all or nothing: an editor can't delete other people's files", async () => {
    const owner = await addUser("media-owner", "editor");
    const other = await addUser("media-other", "editor");
    const mine = await upload("mine.png", other);
    const theirs = await upload("theirs.png", owner);
    await expect(deleteMediaMany([mine.id, theirs.id], { id: other, role: "editor" })).rejects.toMatchObject({
      status: 403,
    });
    expect(existsSync(mine.file) && existsSync(theirs.file)).toBe(true);
    await deleteMediaMany([mine.id], { id: other, role: "editor" });
    expect(existsSync(mine.file)).toBe(false);
  });

  it("“delete unused” keeps what pages and the trash show, removes the rest and stray files", async () => {
    const uid = await addUser("media-unused", "admin");
    const shown = await upload("shown.png", uid);
    const binned = await upload("binned.png", uid);
    const oldOnly = await upload("old.png", uid);
    const unused = await upload("unused.png", uid);
    // shown on a page; shown on a page that's now in the trash; shown only in an older version
    await createPage({ title: "Zeigt Bild", content: `![](/media/${shown.name})`, parentId: null, userId: uid });
    const b = await createPage({
      title: "Im Papierkorb",
      content: `![](/media/${binned.name})`,
      parentId: null,
      userId: uid,
    });
    await trashPage(b.slug, uid);
    const h = await createPage({
      title: "Hatte Bild",
      content: `![](/media/${oldOnly.name})`,
      parentId: null,
      userId: uid,
    });
    await updatePage(h.slug, { title: h.title, content: "ohne Bild", parentId: null, expectedRev: h.rev, userId: uid });
    const list = new Map((await listMedia()).map((m) => [m.id, m]));
    expect(list.get(shown.id)).toMatchObject({ used_in: 1, in_trash: 0 });
    expect(list.get(binned.id)).toMatchObject({ used_in: 0, in_trash: 1 });
    expect(list.get(oldOnly.id)).toMatchObject({ used_in: 0, in_trash: 0, in_history: true });
    expect(list.get(unused.id)).toMatchObject({ used_in: 0, in_trash: 0, in_history: false });
    // a file without an entry (crash) and an abandoned partial upload, both old; and a fresh one
    const stray = path.join(MEDIA_DIR(), "AAAAAAAAAAAAAAAAAAAAAA.png");
    const partial = path.join(MEDIA_DIR(), ".upload-abcdef");
    const fresh = path.join(MEDIA_DIR(), "BBBBBBBBBBBBBBBBBBBBBB.png");
    for (const f of [stray, partial, fresh]) writeFileSync(f, "x".repeat(1000));
    const old = new Date(Date.now() - 2 * 3600_000);
    utimesSync(stray, old, old);
    utimesSync(partial, old, old);

    const r = await deleteUnusedMedia();
    const ids = r.files.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([oldOnly.id, unused.id]));
    expect(ids).not.toContain(shown.id);
    expect(ids).not.toContain(binned.id);
    expect(r.strays).toBe(2);
    expect(r.bytes).toBe(r.files.reduce((x, m) => x + m.size, 0) + 2000);
    expect(existsSync(shown.file) && existsSync(binned.file)).toBe(true);
    expect(existsSync(oldOnly.file) || existsSync(unused.file) || existsSync(stray) || existsSync(partial)).toBe(false);
    expect(existsSync(fresh)).toBe(true); // could be an upload in progress: left alone
    expect((await sweepMediaDir()).count).toBe(0);
    expect(statSync(MEDIA_DIR()).isDirectory()).toBe(true);
    expect(await getPage("zeigt-bild")).toBeDefined();
  });
});
