import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipPassThrough } from "fflate";
import { DATA_DIR } from "./config";
import { all, one, run, sql, syncIdentity, tx, now, type Sql } from "./db";
import { SCHEMA_VERSION } from "./schema";
import { decrypt, encrypt } from "./crypto";
import { MEDIA_DIR } from "./media";
import { getSettings, type Settings } from "./settings";
import { HttpError } from "./validate";
import { waitForDrain } from "./stream-util";
import { decryptStream, encryptStream, objectName, openBuffer, sealBuffer } from "./backup-crypto";
import { checkLocalDir, KEY_RE, LocalStore, S3Store, type BackupStore, type S3Config } from "./backup-store";
import { reindexAll, flushIndex } from "./search";
import { rebuildLinks, updatePage } from "./pages";
import { reinsertPage } from "./trash";
import { publish } from "./events";
import { reapplyErasures } from "./admin";

/*
 * Backups — encrypted, logical, restorable as a whole or one page / one account at a time.
 *
 *   v2/<id>.manifest     what's inside: counts, an index of pages and accounts, media list
 *   v2/<id>.data         every row of every table, one JSON line each
 *   v2/objects/<name>    uploaded files, stored once however many backups contain them
 *
 * All three are encrypted and authenticated (backup-crypto.ts) with keys derived from the master
 * key, so the storage (a NAS, S3) only ever sees ciphertext — and a backup can only be restored
 * by an installation with the same master key. Nothing in a backup is SQL: restoring inserts
 * values through bound parameters into an explicit column list, so a backup can't carry code.
 *
 * Not included on purpose: sessions, reset links, rate-limit and lock-out counters (a restore
 * signs everyone out), and the search and link indexes (rebuilt after a restore).
 */

/** The folder backups go to unless the owner picked another one: the `/backups` mount in Docker. */
export const DEFAULT_BACKUP_DIR = () =>
  process.env.WIKI_BACKUP_DIR || path.join(/* turbopackIgnore: true */ DATA_DIR, "backups");

/**
 * Where the owner may point backups in the settings: inside these folders only (an allow-list, so
 * a typo or a stolen owner session can't aim the wiki at arbitrary places). Docker mounts other
 * disks and shares there; WIKI_BACKUP_ROOTS replaces the list.
 */
export function backupRoots(): string[] {
  const raw = process.env.WIKI_BACKUP_ROOTS;
  const list = raw ? raw.split(",") : ["/backups", "/mnt", "/media", "/srv", DEFAULT_BACKUP_DIR()];
  const out = new Set<string>();
  for (const r of list.map((x) => x.trim().replace(/(.)\/+$/, "$1"))) {
    if (r.startsWith("/") && r !== "/" && path.posix.normalize(r) === r) out.add(r);
  }
  return [...out];
}

/** The folder the "local" target writes to right now. */
export const localBackupDir = (s: Pick<Settings, "backup_local_dir">) => s.backup_local_dir || DEFAULT_BACKUP_DIR();

/** A store for a folder: the default one, or one the owner chose (which must already exist). */
export const localStore = (dir: string) => new LocalStore(dir, { mustExist: dir !== DEFAULT_BACKUP_DIR() });

/** Validates a folder typed by the owner ("" = the default folder). */
export function checkBackupDir(input: unknown): string {
  if (typeof input === "string" && (input.trim() === "" || input.trim() === DEFAULT_BACKUP_DIR())) return "";
  return checkLocalDir(input, {
    roots: backupRoots(),
    avoid: [path.resolve(DATA_DIR), path.resolve(/* turbopackIgnore: true */ process.cwd())],
  });
}
const ID_RE = /^\d{8}-\d{6}-[0-9a-f]{6}$/;
const MEDIA_NAME = /^[A-Za-z0-9_-]{16,40}\.(?:png|jpg|gif|webp|mp4|webm|ogv|mov)$/;
const KEEP_SAFETY = 5;
const UPLOAD_CAP = (Number.parseInt(process.env.WIKI_MAX_BACKUP_UPLOAD_MB || "", 10) || 20480) * 1024 * 1024;
export { UPLOAD_CAP as BACKUP_UPLOAD_CAP };

export type BackupReason = "auto" | "manual" | "pre-restore" | "pre-import" | "upload";
const REASONS: readonly BackupReason[] = ["auto", "manual", "pre-restore", "pre-import", "upload"];

/* ------------------------------------------------------------- the tables */

/** Every column that is backed up and restored — nothing else is ever written back. */
export const TABLES = {
  users: [
    "id",
    "username",
    "email",
    "password_hash",
    "role",
    "disabled",
    "totp_secret_enc",
    "totp_pending_enc",
    "totp_enabled",
    "totp_last_step",
    "recovery_hashes",
    "created_at",
    "password_changed_at",
    "is_owner",
  ],
  settings: ["key", "value"],
  pages: [
    "id",
    "slug",
    "title",
    "parent_id",
    "position",
    "content",
    "rev",
    "created_by",
    "updated_by",
    "created_at",
    "updated_at",
    "system_key",
  ],
  page_revisions: ["id", "page_id", "rev", "title", "content", "author_id", "created_at", "comment", "restored_from"],
  media: ["id", "name", "mime", "kind", "size", "original_name", "created_by", "created_at"],
  legal_pages: ["key", "lang", "content", "updated_by", "updated_at"],
  totp_devices: ["id", "user_id", "name", "secret_enc", "last_step", "created_at", "last_used_at"],
  trash: [
    "id",
    "page_id",
    "slug",
    "title",
    "parent_id",
    "position",
    "content",
    "rev",
    "created_by",
    "updated_by",
    "created_at",
    "updated_at",
    "system_key",
    "children",
    "deleted_by",
    "deleted_at",
  ],
  trash_revisions: [
    "trash_id",
    "orig_id",
    "rev",
    "title",
    "content",
    "author_id",
    "created_at",
    "comment",
    "restored_from",
  ],
  audit_log: ["id", "ts", "user_id", "event", "ip", "detail", "target_id"],
} as const;
export type Table = keyof typeof TABLES;
/** Insert order (foreign keys); pages' parent links are set in a second pass. */
export const ORDER: readonly Table[] = [
  "users",
  "settings",
  "pages",
  "page_revisions",
  "media",
  "legal_pages",
  "totp_devices",
  "trash",
  "trash_revisions",
  "audit_log",
];
const KEYS: Record<Table, readonly string[]> = {
  users: ["id"],
  settings: ["key"],
  pages: ["id"],
  page_revisions: ["id"],
  media: ["id"],
  legal_pages: ["key", "lang"],
  totp_devices: ["id"],
  trash: ["id"],
  trash_revisions: ["trash_id", "rev"],
  audit_log: ["id"],
};
const ALL_COLUMNS = [...new Set(Object.values(TABLES).flat())];
const ident = (n: string) => sql.ident(n, [...ORDER, ...ALL_COLUMNS]);
const cols = (t: Table) =>
  sql.join(
    TABLES[t].map((c) => sql`${ident(c)}`),
    sql`, `,
  );

/** Settings that describe *where* backups go: they stay as they are when a backup is restored. */
const KEEP_SETTING = (k: string) => k.startsWith("backup_");

/* ------------------------------------------------------------------ store */

const S3_SECRET_KEY = "backup_s3_secret_enc"; // like the SMTP password: never part of the settings API
const S3_AAD = "backup:s3-secret";

export async function setS3Secret(plain: string | null) {
  if (!plain) {
    await run(sql`DELETE FROM settings WHERE key = ${S3_SECRET_KEY}`);
    return;
  }
  await run(
    sql`INSERT INTO settings(key, value) VALUES (${S3_SECRET_KEY}, ${JSON.stringify(encrypt(plain, S3_AAD))})
        ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  );
}
export const hasS3Secret = async () => !!(await one(sql`SELECT 1 FROM settings WHERE key = ${S3_SECRET_KEY}`));
async function s3Secret(): Promise<string> {
  const r = await one<{ value: string }>(sql`SELECT value FROM settings WHERE key = ${S3_SECRET_KEY}`);
  if (!r) return "";
  try {
    return decrypt(JSON.parse(r.value), S3_AAD);
  } catch {
    return "";
  }
}

export async function s3ConfigFromSettings(override: Partial<S3Config> = {}): Promise<S3Config> {
  const s = await getSettings();
  return {
    endpoint: s.backup_s3_endpoint,
    region: s.backup_s3_region,
    bucket: s.backup_s3_bucket,
    prefix: s.backup_s3_prefix,
    accessKey: s.backup_s3_access_key,
    secretKey: await s3Secret(),
    pathStyle: s.backup_s3_path_style,
    ...override,
  };
}

const g = globalThis as unknown as { __wikiStoreOverride?: BackupStore };
/** Tests point the backups at another store. */
export const setStoreForTests = (s: BackupStore | undefined) => {
  g.__wikiStoreOverride = s;
};

export async function backupStore(): Promise<BackupStore> {
  if (g.__wikiStoreOverride) return g.__wikiStoreOverride;
  const s = await getSettings();
  if (s.backup_target === "s3") return new S3Store(await s3ConfigFromSettings());
  return localStore(localBackupDir(s));
}

/* ------------------------------------------------------------------- lock */

const gl = globalThis as unknown as { __wikiBackupBusy?: string | null };
async function locked<T>(what: string, fn: () => Promise<T>): Promise<T> {
  if (gl.__wikiBackupBusy) throw new HttpError(409, "Another import or backup is running. Try again in a moment.");
  gl.__wikiBackupBusy = what;
  try {
    return await fn();
  } finally {
    gl.__wikiBackupBusy = null;
  }
}
export const backupBusy = () => !!gl.__wikiBackupBusy;
/** For other whole-wiki writers (the importer): never at the same time as a backup or restore. */
export const exclusive = locked;

/* ---------------------------------------------------------------- scratch */

const SCRATCH = () => path.join(/* turbopackIgnore: true */ DATA_DIR, ".backup-work");
function scratchDir() {
  mkdirSync(SCRATCH(), { recursive: true, mode: 0o700 });
  const d = path.join(/* turbopackIgnore: true */ SCRATCH(), randomBytes(8).toString("hex"));
  mkdirSync(d, { mode: 0o700 });
  return d;
}
/** Leftovers of a crash (plaintext never lands here, but keep the folder clean anyway). */
function sweepScratch() {
  if (!existsSync(SCRATCH())) return;
  for (const f of readdirSync(SCRATCH())) {
    const p = path.join(/* turbopackIgnore: true */ SCRATCH(), f);
    try {
      if (statSync(p).mtimeMs < Date.now() - 6 * 3600_000) rmSync(p, { recursive: true, force: true });
    } catch {
      /* gone */
    }
  }
}

function newId(t = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}-` +
    `${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}-${randomBytes(3).toString("hex")}`
  );
}
const checkId = (id: string) => {
  if (!ID_RE.test(id)) throw new HttpError(404, "Backup not found.");
  return id;
};

async function sha256File(file: string): Promise<Buffer> {
  const h = createHash("sha256");
  for await (const c of createReadStream(file)) h.update(c as Buffer);
  return h.digest();
}

/* --------------------------------------------------------------- manifest */

export type PageEntry = { id: number; slug: string; title: string; rev: number; parent_id: number | null };
export type UserEntry = {
  id: number;
  username: string;
  email: string;
  role: string;
  is_owner: number;
  disabled: number;
};
export type MediaEntry = { name: string; mime: string; kind: string; size: number; object: string };
export type Manifest = {
  format: "tidewiki-backup";
  version: 2;
  id: string;
  created_at: number;
  created_ms: number;
  reason: BackupReason;
  schema: number;
  original_created_at?: number;
  counts: Record<Table, number>;
  data_size: number;
  media: MediaEntry[];
  pages: PageEntry[];
  users: UserEntry[];
};
export type BackupInfo = Omit<Manifest, "media" | "pages" | "users"> & { media_count: number; media_bytes: number };

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const isStr = (v: unknown, max = 1000): v is string => typeof v === "string" && v.length <= max;

/** Decrypts and checks a manifest's shape. A manifest that fails either is treated as absent. */
async function loadManifest(st: BackupStore, id: string): Promise<Manifest> {
  checkId(id);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of await st.get(`v2/${id}.manifest`)) {
    size += (c as Buffer).length;
    if (size > 64 * 1024 * 1024) throw new HttpError(400, "This backup is damaged.");
    chunks.push(c as Buffer);
  }
  let m: Manifest;
  try {
    m = JSON.parse((await openBuffer("manifest", id, Buffer.concat(chunks))).toString("utf8"));
  } catch {
    throw new HttpError(400, "This backup can’t be read with this wiki’s master key, or it is damaged.");
  }
  const ok =
    m?.format === "tidewiki-backup" &&
    m.version === 2 &&
    m.id === id &&
    isInt(m.created_at) &&
    REASONS.includes(m.reason) &&
    isInt(m.schema) &&
    Array.isArray(m.media) &&
    Array.isArray(m.pages) &&
    Array.isArray(m.users) &&
    m.media.every((x) => MEDIA_NAME.test(x.name) && /^[0-9a-f]{64}$/.test(x.object) && isInt(x.size)) &&
    m.pages.every((p) => isInt(p.id) && isStr(p.slug, 80) && isStr(p.title, 500) && isInt(p.rev)) &&
    m.users.every((u) => isInt(u.id) && isStr(u.username, 64) && isStr(u.email, 254) && isStr(u.role, 10));
  if (!ok) throw new HttpError(400, "This backup is damaged.");
  return m;
}

/* ----------------------------------------------------------------- create */

const LINE_MAX = 64 * 1024 * 1024;

/** Writes all rows as JSON lines through the cipher into `file`; returns counts and the manifest index. */
async function dumpData(id: string, file: string) {
  const counts = Object.fromEntries(ORDER.map((t) => [t, 0])) as Record<Table, number>;
  const pages: PageEntry[] = [];
  const users: UserEntry[] = [];
  const media: Omit<MediaEntry, "object">[] = [];
  const cipher = encryptStream("data", id);
  const out = createWriteStream(file, { mode: 0o600 });
  const piping = pipeline(cipher, out);
  const write = async (obj: unknown) => {
    if (!cipher.write(Buffer.from(JSON.stringify(obj) + "\n", "utf8"))) await waitForDrain(cipher);
  };
  // one consistent snapshot of every table; a read-only deferrable transaction never conflicts
  await tx(
    async () => {
      for (const k of Object.keys(counts) as Table[]) counts[k] = 0;
      pages.length = users.length = media.length = 0;
      await write({ t: "header", format: "tidewiki-backup", version: 2, schema: SCHEMA_VERSION, tables: TABLES });
      for (const t of ORDER) {
        const key = KEYS[t];
        let after: unknown[] | null = null;
        for (;;) {
          const where: Sql = after
            ? sql`WHERE (${sql.join(
                key.map((c) => sql`${ident(c)}`),
                sql`, `,
              )}) > (${sql.join(
                after.map((v) => sql`${v}`),
                sql`, `,
              )})`
            : sql``;
          const rows: Record<string, unknown>[] = await all(
            sql`SELECT ${cols(t)} FROM ${ident(t)} ${where} ORDER BY ${sql.join(
              key.map((c) => sql`${ident(c)}`),
              sql`, `,
            )} LIMIT 500`,
          );
          if (!rows.length) break;
          for (const r of rows) {
            if (t === "settings" && (r.key === S3_SECRET_KEY || KEEP_SETTING(String(r.key)))) continue;
            await write({ t, r: TABLES[t].map((c) => r[c]) });
            counts[t]++;
            if (t === "pages")
              pages.push({
                id: r.id as number,
                slug: r.slug as string,
                title: r.title as string,
                rev: r.rev as number,
                parent_id: r.parent_id as number | null,
              });
            if (t === "users")
              users.push({
                id: r.id as number,
                username: r.username as string,
                email: r.email as string,
                role: r.role as string,
                is_owner: r.is_owner as number,
                disabled: r.disabled as number,
              });
            if (t === "media")
              media.push({
                name: r.name as string,
                mime: r.mime as string,
                kind: r.kind as string,
                size: r.size as number,
              });
          }
          const last: Record<string, unknown> = rows[rows.length - 1];
          after = key.map((c): unknown => last[c]);
        }
      }
      await write({ t: "end", counts });
    },
    { readOnly: true },
  );
  cipher.end();
  await piping;
  return { counts, pages, users, media };
}

/** Uploads every media file not yet in the store (deduplicated by content). */
async function storeMedia(st: BackupStore, list: Omit<MediaEntry, "object">[], work: string): Promise<MediaEntry[]> {
  const have = new Set((await st.list("v2/objects/")).map((o) => o.key.slice("v2/objects/".length)));
  const out: MediaEntry[] = [];
  for (const m of list) {
    const file = path.join(/* turbopackIgnore: true */ MEDIA_DIR(), m.name);
    if (!MEDIA_NAME.test(m.name) || !existsSync(file)) continue; // missing on disk already; restore reports it
    const obj = objectName(await sha256File(file));
    if (!have.has(obj)) {
      const tmp = path.join(/* turbopackIgnore: true */ work, obj);
      await pipeline(createReadStream(file), encryptStream("object", obj), createWriteStream(tmp, { mode: 0o600 }));
      await st.put(`v2/objects/${obj}`, tmp);
      rmSync(tmp, { force: true });
      have.add(obj);
    }
    out.push({ ...m, object: obj });
  }
  return out;
}

async function createUnlocked(reason: BackupReason, extra: { original_created_at?: number } = {}): Promise<Manifest> {
  const st = await backupStore();
  const id = newId();
  const work = scratchDir();
  try {
    const dataFile = path.join(/* turbopackIgnore: true */ work, "data");
    const d = await dumpData(id, dataFile);
    const media = await storeMedia(st, d.media, work);
    // data first, manifest last: a backup only appears in the list once it is complete
    await st.put(`v2/${id}.data`, dataFile);
    const m: Manifest = {
      format: "tidewiki-backup",
      version: 2,
      id,
      created_at: now(),
      created_ms: Date.now(),
      reason,
      schema: SCHEMA_VERSION,
      ...extra,
      counts: d.counts,
      data_size: statSync(dataFile).size,
      media,
      pages: d.pages,
      users: d.users,
    };
    const mf = path.join(/* turbopackIgnore: true */ work, "manifest");
    await pipeline(
      Readable.from([await sealBuffer("manifest", id, Buffer.from(JSON.stringify(m)))]),
      createWriteStream(mf, { mode: 0o600 }),
    );
    await st.put(`v2/${id}.manifest`, mf);
    await prune(st);
    return m;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export const createBackup = (reason: BackupReason = "manual") => locked("create", () => createUnlocked(reason));
/** A safety backup from inside `exclusive` (e.g. right before an import is applied). */
export const createBackupInLock = (reason: BackupReason) => createUnlocked(reason);

/* ------------------------------------------------------------- list/prune */

async function manifests(st: BackupStore): Promise<{ list: Manifest[]; unreadable: number }> {
  const keys = (await st.list("v2/")).map((o) => o.key).filter((k) => k.endsWith(".manifest"));
  const list: Manifest[] = [];
  let unreadable = 0;
  for (const k of keys) {
    const id = k.slice(3, -".manifest".length);
    try {
      list.push(await loadManifest(st, id));
    } catch {
      unreadable++;
    }
  }
  return { list: list.sort((a, b) => b.created_ms - a.created_ms || b.id.localeCompare(a.id)), unreadable };
}

export async function listBackups(): Promise<{ items: BackupInfo[]; unreadable: number; where: string }> {
  const st = await backupStore();
  const { list, unreadable } = await manifests(st);
  return {
    items: list.map(({ media, pages, users, ...rest }) => {
      void pages;
      void users;
      return { ...rest, media_count: media.length, media_bytes: media.reduce((s, m) => s + m.size, 0) };
    }),
    unreadable,
    where: st.describe(),
  };
}

export async function getManifest(id: string): Promise<Manifest> {
  return loadManifest(await backupStore(), id);
}

/**
 * Keeps the newest `backup_keep` automatic backups and the newest few safety copies; manual and
 * uploaded backups stay. Then removes objects no backup refers to — but only when every manifest
 * could be read (an unreadable one might still need them).
 */
async function prune(st: BackupStore) {
  const keep = (await getSettings()).backup_keep;
  const { list, unreadable } = await manifests(st);
  const drop = [
    ...list.filter((b) => b.reason === "auto").slice(keep),
    ...list.filter((b) => b.reason === "pre-restore" || b.reason === "pre-import").slice(KEEP_SAFETY),
  ];
  for (const b of drop) await removeFiles(st, b.id);
  if (unreadable) return;
  const kept = list.filter((b) => !drop.includes(b));
  await gcObjects(st, kept);
  sweepScratch();
}

async function removeFiles(st: BackupStore, id: string) {
  await st.delete(`v2/${id}.manifest`); // first: from now on the backup no longer exists
  await st.delete(`v2/${id}.data`);
}

async function gcObjects(st: BackupStore, kept: Manifest[]) {
  const used = new Set(kept.flatMap((m) => m.media.map((x) => x.object)));
  for (const o of await st.list("v2/objects/")) {
    const name = o.key.slice("v2/objects/".length);
    if (!used.has(name)) await st.delete(o.key);
  }
  // data files whose manifest never got written (crash mid-backup), older than a day
  const ids = new Set(kept.map((m) => m.id));
  for (const o of await st.list("v2/")) {
    if (!o.key.endsWith(".data")) continue;
    const id = o.key.slice(3, -".data".length);
    const ts = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(id);
    const at = ts ? Date.UTC(+ts[1], +ts[2] - 1, +ts[3], +ts[4], +ts[5], +ts[6]) : 0;
    if (!ids.has(id) && at < Date.now() - 86400_000) await st.delete(o.key);
  }
}

export const deleteBackup = (id: string) =>
  locked("delete", async () => {
    const st = await backupStore();
    const m = await loadManifest(st, id);
    await removeFiles(st, id);
    const { list, unreadable } = await manifests(st);
    if (!unreadable) await gcObjects(st, list);
    return m;
  });

/* -------------------------------------------------------------- reading */

type Rec = { t: Table; r: unknown[] };

/** Copies the encrypted data file to local scratch (so a slow store never holds a transaction open). */
async function fetchData(st: BackupStore, id: string, work: string): Promise<string> {
  const f = path.join(/* turbopackIgnore: true */ work, "data");
  await pipeline(await st.get(`v2/${id}.data`), createWriteStream(f, { mode: 0o600 }));
  return f;
}

/** Streams the records of a (local, encrypted) data file; every record is checked before it is used. */
async function eachRecord(id: string, file: string, fn: (rec: Rec) => Promise<void> | void) {
  let pending = "";
  let sawHeader = false,
    sawEnd = false;
  const handle = async (line: string) => {
    if (!line) return;
    let o: { t?: unknown; r?: unknown; format?: unknown; version?: unknown };
    try {
      o = JSON.parse(line);
    } catch {
      throw new HttpError(400, "This backup is damaged.");
    }
    if (o.t === "header") {
      if (o.format !== "tidewiki-backup" || o.version !== 2) throw new HttpError(400, "This backup is damaged.");
      sawHeader = true;
      return;
    }
    if (o.t === "end") {
      sawEnd = true;
      return;
    }
    if (!sawHeader || sawEnd) throw new HttpError(400, "This backup is damaged.");
    const t = o.t as Table;
    if (typeof t !== "string" || !Object.prototype.hasOwnProperty.call(TABLES, t))
      throw new HttpError(400, "This backup is damaged.");
    if (!Array.isArray(o.r) || o.r.length !== TABLES[t].length) throw new HttpError(400, "This backup is damaged.");
    for (const v of o.r)
      if (!(v === null || typeof v === "string" || (typeof v === "number" && Number.isSafeInteger(v))))
        throw new HttpError(400, "This backup is damaged.");
    await fn({ t, r: o.r });
  };
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const consume = async (chunk: Buffer | null) => {
    pending += chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode();
    if (pending.length > LINE_MAX) throw new HttpError(400, "This backup is damaged.");
    let nl: number;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, nl);
      pending = pending.slice(nl + 1);
      await handle(line);
    }
    if (!chunk) await handle(pending);
  };
  const sink = new Writable({
    write(chunk: Buffer, _e, cb) {
      consume(chunk).then(
        () => cb(),
        (e: Error) => cb(e),
      );
    },
    final(cb) {
      consume(null).then(
        () => cb(),
        (e: Error) => cb(e),
      );
    },
  });
  try {
    await pipeline(createReadStream(file), decryptStream("data", id), sink);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "This backup can’t be read with this wiki’s master key, or it is damaged.");
  }
  if (!sawHeader || !sawEnd) throw new HttpError(400, "This backup is damaged.");
}

const asRow = (t: Table, r: unknown[]) =>
  Object.fromEntries(TABLES[t].map((c, i) => [c, r[i]])) as Record<string, unknown>;

/** Fetches, decrypts and verifies one media object into `dest` (content must match its name). */
async function fetchObject(st: BackupStore, obj: string, dest: string) {
  const h = createHash("sha256");
  const tap = new Transform({
    transform(c: Buffer, _e, cb) {
      h.update(c);
      cb(null, c);
    },
  });
  const tmp = `${dest}.part-${randomBytes(4).toString("hex")}`;
  try {
    await pipeline(
      await st.get(`v2/objects/${obj}`),
      decryptStream("object", obj),
      tap,
      createWriteStream(tmp, { mode: 0o600 }),
    );
    if (objectName(h.digest()) !== obj) throw new HttpError(400, "This backup is damaged.");
    renameSync(tmp, dest);
  } catch (e) {
    rmSync(tmp, { force: true });
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "This backup is damaged.");
  }
}

/** Verifies a whole backup: every record decrypts and parses, every file is present and intact. */
export async function verifyBackup(id: string) {
  const st = await backupStore();
  const m = await loadManifest(st, id);
  const work = scratchDir();
  try {
    const f = await fetchData(st, id, work);
    const counts = Object.fromEntries(ORDER.map((t) => [t, 0])) as Record<Table, number>;
    await eachRecord(id, f, (rec) => {
      counts[rec.t]++;
    });
    const mismatch = ORDER.filter((t) => counts[t] !== m.counts[t]);
    let badFiles = 0;
    for (const x of m.media) {
      try {
        await fetchObject(st, x.object, path.join(/* turbopackIgnore: true */ work, "obj"));
      } catch {
        badFiles++;
      }
      rmSync(path.join(/* turbopackIgnore: true */ work, "obj"), { force: true });
    }
    return { ok: !mismatch.length && !badFiles, records: counts, badFiles, mismatch };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/* ----------------------------------------------------------- full restore */

/** Inserts rows of one table in batches, through the explicit column list only. */
export async function insertRows(t: Table, rows: unknown[][]) {
  if (!rows.length) return;
  const values = rows.map(
    (r) =>
      sql`(${sql.join(
        r.map((v) => sql`${v}`),
        sql`, `,
      )})`,
  );
  await run(sql`INSERT INTO ${ident(t)} (${cols(t)}) VALUES ${sql.join(values, sql`, `)}`);
}

/**
 * Replaces the whole wiki with a backup (owner only, password confirmed by the route):
 *  1. read and fully verify the backup and fetch every file — nothing has changed yet;
 *  2. take a safety backup of the current state, so the restore itself can be undone;
 *  3. one transaction: empty the tables, insert every row, fix sequences; all or nothing;
 *  4. swap the media folder contents, rebuild search and link indexes. Everyone is signed out.
 */
export function restoreBackup(id: string): Promise<{ safety: string; missing: number }> {
  return locked("restore", async () => {
    const st = await backupStore();
    const m = await loadManifest(st, id);
    if (m.schema > SCHEMA_VERSION)
      throw new HttpError(400, "This backup was made by a newer Tidewiki version. Update first, then restore.");
    const owners = m.users.filter((u) => u.is_owner === 1 && u.role === "admin" && !u.disabled);
    if (owners.length !== 1 || !m.users.some((u) => u.role === "admin" && !u.disabled))
      throw new HttpError(400, "The backup doesn’t have exactly one active owner. Refused.");
    const work = scratchDir();
    try {
      const dataFile = await fetchData(st, id, work);
      await eachRecord(id, dataFile, () => {}); // verify everything before touching anything
      const staged = path.join(/* turbopackIgnore: true */ work, "media");
      mkdirSync(staged, { mode: 0o700 });
      let missing = 0;
      for (const x of m.media) {
        try {
          await fetchObject(st, x.object, path.join(/* turbopackIgnore: true */ staged, x.name));
        } catch {
          missing++;
        }
      }
      const safety = await createUnlocked("pre-restore");

      await tx(async () => {
        const keep = await all<{ key: string; value: string }>(sql`SELECT key, value FROM settings`);
        await run(
          sql`TRUNCATE users, settings, pages, page_revisions, page_links, search_idx, search_dirty, media, legal_pages,
                totp_devices, trash, trash_revisions, audit_log, sessions, reset_tokens, rate_limits, lockouts`,
        );
        const batch: Record<string, unknown[][]> = {};
        const parents: [number, number][] = [];
        let current: Table | null = null;
        const flush = async () => {
          if (current && batch[current]?.length) await insertRows(current, batch[current]);
          if (current) batch[current] = [];
        };
        await eachRecord(id, dataFile, async ({ t, r }) => {
          if (t !== current) {
            await flush();
            current = t;
          }
          if (t === "settings" && KEEP_SETTING(String(r[0]))) return;
          if (t === "pages" && r[3] !== null) {
            parents.push([r[0] as number, r[3] as number]);
            r = [...r];
            r[3] = null; // parents may come later in id order; linked in a second pass
          }
          (batch[t] ??= []).push(r);
          if (batch[t].length >= 200) await flush();
        });
        await flush();
        for (const [pid, parent] of parents) await run(sql`UPDATE pages SET parent_id = ${parent} WHERE id = ${pid}`);
        // the backup target and the S3 secret stay those of this installation
        for (const s of keep.filter((x) => KEEP_SETTING(x.key)))
          await run(
            sql`INSERT INTO settings(key, value) VALUES (${s.key}, ${s.value}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
          );
        for (const t of ["users", "pages", "page_revisions", "trash", "media", "totp_devices", "audit_log"] as const)
          await syncIdentity(t);
        const ow = await one<{ n: number }>(
          sql`SELECT COUNT(*) AS n FROM users WHERE is_owner = 1 AND role = 'admin' AND disabled = 0`,
        );
        if (ow?.n !== 1) throw new HttpError(400, "The backup doesn’t have exactly one active owner. Refused.");
        await reindexAll();
      });
      await rebuildLinks();
      await reapplyErasures(); // erasure requests made after the backup stay in force

      // media: exactly the backup's files (anything else is in the safety backup)
      mkdirSync(MEDIA_DIR(), { recursive: true, mode: 0o700 });
      const want = new Set(m.media.map((x) => x.name));
      for (const name of readdirSync(staged))
        renameOrCopy(
          path.join(/* turbopackIgnore: true */ staged, name),
          path.join(/* turbopackIgnore: true */ MEDIA_DIR(), name),
        );
      for (const f of readdirSync(MEDIA_DIR(), { withFileTypes: true }))
        if (f.isFile() && !f.name.startsWith(".") && !want.has(f.name))
          rmSync(path.join(/* turbopackIgnore: true */ MEDIA_DIR(), f.name), { force: true });
      void flushIndex().catch(() => {});
      return { safety: safety.id, missing };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
}

function renameOrCopy(src: string, dst: string) {
  try {
    renameSync(src, dst);
  } catch {
    try {
      linkSync(src, dst);
    } catch {
      /* already there */
    }
  }
}

/* ------------------------------------------------------ single page restore */

/** Media names a Markdown text refers to. */
const mediaRefs = (md: string) =>
  new Set([...md.matchAll(/\/media\/([A-Za-z0-9_-]{16,40}\.(?:png|jpg|gif|webp|mp4|webm|ogv|mov))/g)].map((x) => x[1]));

async function restoreMediaFor(st: BackupStore, m: Manifest, contents: string[], work: string): Promise<number> {
  const refs = new Set(contents.flatMap((c) => [...mediaRefs(c)]));
  let restored = 0;
  for (const name of refs) {
    if (await one(sql`SELECT 1 FROM media WHERE name = ${name}`)) continue;
    const x = m.media.find((e) => e.name === name);
    if (!x) continue;
    const staged = path.join(/* turbopackIgnore: true */ work, name);
    await fetchObject(st, x.object, staged);
    mkdirSync(MEDIA_DIR(), { recursive: true, mode: 0o700 });
    renameOrCopy(staged, path.join(/* turbopackIgnore: true */ MEDIA_DIR(), name));
    await run(
      sql`INSERT INTO media(name, mime, kind, size, original_name, created_by, created_at)
          VALUES (${name}, ${x.mime}, ${x.kind}, ${statSync(path.join(/* turbopackIgnore: true */ MEDIA_DIR(), name)).size}, NULL, NULL, ${now()})
          ON CONFLICT (name) DO NOTHING`,
    );
    restored++;
  }
  return restored;
}

/**
 * Brings one page back from a backup (administrators and the owner). Never destructive:
 *  - the page still exists → the backup's title and text become a new version on top;
 *  - the page is gone → it is recreated with its complete history from the backup.
 * Files the page shows that no longer exist are restored as well.
 */
export function restorePage(id: string, pageId: number, userId: number) {
  return locked("restore-page", async () => {
    const st = await backupStore();
    const m = await loadManifest(st, id);
    const entry = m.pages.find((p) => p.id === pageId);
    if (!entry) throw new HttpError(404, "This page isn’t in the backup.");
    const work = scratchDir();
    try {
      const f = await fetchData(st, id, work);
      let page: Record<string, unknown> | null = null;
      const revs: Record<string, unknown>[] = [];
      await eachRecord(id, f, ({ t, r }) => {
        if (t === "pages" && r[0] === pageId) page = asRow(t, r);
        if (t === "page_revisions" && r[1] === pageId) revs.push(asRow(t, r));
      });
      const p = page as Record<string, unknown> | null;
      if (!p) throw new HttpError(404, "This page isn’t in the backup.");
      const files = await restoreMediaFor(st, m, [String(p.content)], work);
      const label = new Date(m.created_at * 1000).toISOString().slice(0, 16).replace("T", " ");
      const cur = await one<{ slug: string; rev: number; title: string; content: string; parent_id: number | null }>(
        sql`SELECT slug, rev, title, content, parent_id FROM pages WHERE id = ${pageId}`,
      );
      if (cur) {
        if (cur.title === p.title && cur.content === p.content)
          throw new HttpError(409, "The page is identical to the version in the backup.");
        const u = await updatePage(cur.slug, {
          title: String(p.title),
          content: String(p.content),
          parentId: cur.parent_id,
          expectedRev: cur.rev,
          userId,
          comment: `Backup ${label} UTC`,
        });
        return { mode: "version" as const, slug: u.slug, files };
      }
      const res = await tx(() =>
        reinsertPage(
          {
            page_id: pageId,
            slug: String(p.slug),
            title: String(p.title),
            parent_id: (p.parent_id as number | null) ?? null,
            position: Number(p.position),
            content: String(p.content),
            rev: Number(p.rev),
            created_by: (p.created_by as number | null) ?? null,
            updated_by: (p.updated_by as number | null) ?? null,
            created_at: Number(p.created_at),
            updated_at: Number(p.updated_at),
            system_key: (p.system_key as string | null) ?? null,
            revisions: revisionSource(revs),
          },
          [],
        ),
      );
      publish({ type: "page.created", slug: res.page.slug, title: res.page.title, rev: res.page.rev });
      return { mode: "recreated" as const, slug: res.page.slug, files };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
}

/** Revisions as a row source for reinsertPage, bound as one JSON parameter (no SQL from the backup). */
function revisionSource(revs: Record<string, unknown>[]): Sql {
  const json = JSON.stringify(
    revs.map((r) => ({
      orig_id: r.id,
      rev: r.rev,
      title: r.title,
      content: r.content,
      author_id: r.author_id,
      created_at: r.created_at,
      comment: r.comment,
      restored_from: r.restored_from,
    })),
  );
  return sql`SELECT * FROM jsonb_to_recordset(${json}::jsonb) AS x(orig_id bigint, rev bigint, title text, content text,
    author_id bigint, created_at bigint, comment text, restored_from bigint)`;
}

/* ------------------------------------------------------ single user restore */

/**
 * Brings back an account that was deleted (administrators for editors and viewers, the owner for
 * administrators). Same id, name, e-mail, role, password and authenticator devices as in the
 * backup — never the owner flag. Authorship of pages, versions and files that still exist is
 * linked to the account again. An account that still exists is never overwritten.
 */
export function restoreUser(id: string, userId: number, actor: { id: number; isOwner: boolean }) {
  return locked("restore-user", async () => {
    const st = await backupStore();
    const m = await loadManifest(st, id);
    const entry = m.users.find((u) => u.id === userId);
    if (!entry) throw new HttpError(404, "This account isn’t in the backup.");
    if (entry.role === "admin" && !actor.isOwner)
      throw new HttpError(403, "Only the owner can restore administrators.");
    const work = scratchDir();
    try {
      const f = await fetchData(st, id, work);
      let user: Record<string, unknown> | null = null;
      const devices: unknown[][] = [];
      const links = {
        pages_c: [] as number[],
        pages_u: [] as number[],
        revs: [] as number[],
        media: [] as number[],
        trash_c: [] as number[],
      };
      await eachRecord(id, f, ({ t, r }) => {
        const row = asRow(t, r);
        if (t === "users" && row.id === userId) user = row;
        if (t === "totp_devices" && row.user_id === userId) devices.push(r);
        if (t === "pages" && row.created_by === userId) links.pages_c.push(row.id as number);
        if (t === "pages" && row.updated_by === userId) links.pages_u.push(row.id as number);
        if (t === "page_revisions" && row.author_id === userId) links.revs.push(row.id as number);
        if (t === "media" && row.created_by === userId) links.media.push(row.id as number);
        if (t === "trash" && row.created_by === userId) links.trash_c.push(row.id as number);
      });
      const u = user as Record<string, unknown> | null;
      if (!u) throw new HttpError(404, "This account isn’t in the backup.");
      const role = String(u.role);
      if (!["admin", "editor", "viewer"].includes(role)) throw new HttpError(400, "This backup is damaged.");
      if (role === "admin" && !actor.isOwner) throw new HttpError(403, "Only the owner can restore administrators.");
      const r = await tx(async () => {
        if (await one(sql`SELECT 1 FROM users WHERE id = ${userId}`))
          throw new HttpError(409, "This account still exists. Only deleted accounts can be restored.");
        if (await one(sql`SELECT 1 FROM erasures WHERE user_id = ${userId}`))
          throw new HttpError(
            409,
            "This person deleted their account themselves (right to erasure). It can't be restored.",
          );
        if (
          await one(
            sql`SELECT 1 FROM users WHERE lower(username) = lower(${String(u.username)}) OR lower(email) = lower(${String(u.email)})`,
          )
        )
          throw new HttpError(409, "That username or e-mail address is already in use.");
        const row = TABLES.users.map((c) => (c === "is_owner" ? 0 : (u[c] ?? null)));
        await insertRows("users", [row]);
        await syncIdentity("users");
        // devices keep their ids only where free (they're encrypted with the account id, which is the same)
        for (const d of devices) {
          const free = !(await one(sql`SELECT 1 FROM totp_devices WHERE id = ${d[0] as number}`));
          await run(
            sql`INSERT INTO totp_devices(id, user_id, name, secret_enc, last_step, created_at, last_used_at)
                VALUES (COALESCE(${free ? (d[0] as number) : null}::bigint, nextval(pg_get_serial_sequence('totp_devices', 'id'))),
                  ${userId}, ${d[2] as string}, ${d[3] as string}, ${d[4] as number}, ${d[5] as number}, ${d[6] as number | null})`,
          );
        }
        await syncIdentity("totp_devices");
        const relinked =
          (await run(
            sql`UPDATE pages SET created_by = ${userId} WHERE created_by IS NULL AND id = ANY(${links.pages_c}::bigint[])`,
          )) +
          (await run(
            sql`UPDATE pages SET updated_by = ${userId} WHERE updated_by IS NULL AND id = ANY(${links.pages_u}::bigint[])`,
          )) +
          (await run(
            sql`UPDATE page_revisions SET author_id = ${userId} WHERE author_id IS NULL AND id = ANY(${links.revs}::bigint[])`,
          )) +
          (await run(
            sql`UPDATE media SET created_by = ${userId} WHERE created_by IS NULL AND id = ANY(${links.media}::bigint[])`,
          )) +
          (await run(
            sql`UPDATE trash SET created_by = ${userId} WHERE created_by IS NULL AND id = ANY(${links.trash_c}::bigint[])`,
          ));
        return { username: String(u.username), role, relinked, devices: devices.length };
      });
      return r;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
}

/* ------------------------------------------------------- download / upload */

/** One backup as a ZIP of its encrypted files (still encrypted inside — useless without the master key). */
export async function backupZipStream(id: string): Promise<ReadableStream<Uint8Array>> {
  const st = await backupStore();
  const m = await loadManifest(st, id);
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
    if (err) return ctrl.error(err);
    ctrl.enqueue(chunk);
    if (final) ctrl.close();
  });
  const add = async (name: string, key: string) => {
    const entry = new ZipPassThrough(name); // ciphertext doesn't compress
    zip.add(entry);
    for await (const c of await st.get(key)) {
      if (cancelled) return;
      entry.push(new Uint8Array(c as Buffer), false);
      await drained();
    }
    entry.push(new Uint8Array(0), true);
  };
  void (async () => {
    try {
      await add(`${id}.manifest`, `v2/${id}.manifest`);
      await add(`${id}.data`, `v2/${id}.data`);
      for (const o of new Set(m.media.map((x) => x.object))) {
        if (cancelled) return;
        await add(`objects/${o}`, `v2/objects/${o}`);
      }
      zip.end();
    } catch (e) {
      if (!cancelled) ctrl.error(e);
    }
  })();
  return stream;
}

/**
 * Takes a downloaded backup ZIP back in. Only `<id>.manifest`, `<id>.data` and `objects/<64 hex>`
 * are accepted (anything else rejects the archive), sizes are capped while unpacking, and then
 * everything is decrypted and checked — a file that wasn't made by this wiki's master key, or
 * was changed, is refused. The result is a backup in the list; nothing is restored yet.
 */
export function importBackupZip(file: string): Promise<Manifest> {
  return locked("upload", async () => {
    const st = await backupStore();
    const work = scratchDir();
    try {
      const ids = await unpack(file, work);
      if (ids.size !== 1) throw new HttpError(400, "This is not a Tidewiki backup.");
      const id = [...ids][0];
      const mf = path.join(/* turbopackIgnore: true */ work, `${id}.manifest`);
      const df = path.join(/* turbopackIgnore: true */ work, `${id}.data`);
      if (!existsSync(mf) || !existsSync(df)) throw new HttpError(400, "This is not a Tidewiki backup.");
      const local = new LocalStore(work);
      // the local copy is laid out like a store, so the same checks apply
      mkdirSync(path.join(/* turbopackIgnore: true */ work, "v2", "objects"), { recursive: true, mode: 0o700 });
      renameSync(mf, path.join(/* turbopackIgnore: true */ work, "v2", `${id}.manifest`));
      renameSync(df, path.join(/* turbopackIgnore: true */ work, "v2", `${id}.data`));
      const objDir = path.join(/* turbopackIgnore: true */ work, "objects");
      if (existsSync(objDir))
        for (const o of readdirSync(objDir))
          renameSync(
            path.join(/* turbopackIgnore: true */ objDir, o),
            path.join(/* turbopackIgnore: true */ work, "v2", "objects", o),
          );
      const m = await loadManifest(local, id);
      if (await st.exists(`v2/${id}.manifest`)) throw new HttpError(409, "This backup is already in the list.");
      await eachRecord(id, path.join(/* turbopackIgnore: true */ work, "v2", `${id}.data`), () => {});
      const have = new Set((await st.list("v2/objects/")).map((o) => o.key.slice(11)));
      for (const o of new Set(m.media.map((x) => x.object))) {
        const src = path.join(/* turbopackIgnore: true */ work, "v2", "objects", o);
        if (have.has(o)) continue;
        if (!existsSync(src)) continue; // reported as missing files when restoring
        await fetchObject(local, o, path.join(/* turbopackIgnore: true */ work, "check")); // decrypts and checks
        rmSync(path.join(/* turbopackIgnore: true */ work, "check"), { force: true });
        await st.put(`v2/objects/${o}`, src);
      }
      await st.put(`v2/${id}.data`, path.join(/* turbopackIgnore: true */ work, "v2", `${id}.data`));
      await st.put(`v2/${id}.manifest`, path.join(/* turbopackIgnore: true */ work, "v2", `${id}.manifest`));
      return m;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
}

/** Unpacks the archive (names checked before anything is written); returns the backup ids seen. */
async function unpack(file: string, work: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const seen = new Set<string>();
  let total = 0,
    count = 0,
    fatal: Error | null = null;
  const pending = new Set<Promise<void>>();
  const writers = new Set<ReturnType<typeof createWriteStream>>();
  const reject = (msg: string, status = 400) => {
    if (!fatal) fatal = new HttpError(status, msg);
  };
  mkdirSync(path.join(/* turbopackIgnore: true */ work, "objects"), { mode: 0o700 });
  const unzip = new Unzip((f) => {
    if (fatal) return;
    if (++count > 200_000) return reject("The archive has too many files.", 413);
    const name = f.name;
    if (name.endsWith("/")) return;
    let dest: string;
    const top = /^(\d{8}-\d{6}-[0-9a-f]{6})\.(manifest|data)$/.exec(name);
    if (top) {
      ids.add(top[1]);
      dest = path.join(/* turbopackIgnore: true */ work, name);
    } else if (/^objects\/[0-9a-f]{64}$/.test(name)) dest = path.join(/* turbopackIgnore: true */ work, name);
    else return reject("This is not a Tidewiki backup (unexpected file in the archive).");
    if (seen.has(name)) return reject("This is not a Tidewiki backup (duplicate file in the archive).");
    seen.add(name);
    const ws = createWriteStream(dest, { mode: 0o600, flags: "wx" });
    writers.add(ws);
    ws.on("close", () => writers.delete(ws));
    ws.on("error", () => reject("Couldn’t store the upload."));
    const done = new Promise<void>((resolve) => {
      f.ondata = (err, data, final) => {
        if (fatal || err) {
          if (err) reject("This archive can’t be read.");
          ws.destroy();
          return resolve();
        }
        total += data.length;
        if (total > UPLOAD_CAP) {
          reject("The archive unpacks to more data than allowed.", 413);
          f.terminate();
          ws.destroy();
          return resolve();
        }
        ws.write(data);
        if (final) ws.end(() => resolve());
      };
    });
    pending.add(done);
    try {
      f.start();
    } catch {
      reject("This archive can’t be read.");
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
      } catch {
        throw new HttpError(400, "This archive can’t be read.");
      }
      if (fatal) throw fatal;
      if (n === 0) break;
      for (const w of writers) if (w.writableNeedDrain && !w.destroyed) await waitForDrain(w);
      await new Promise((r) => setImmediate(r));
    }
  } finally {
    closeSync(fd);
  }
  await Promise.all(pending);
  if (fatal) throw fatal;
  return ids;
}

/* --------------------------------------------------------------- schedule */

/** Runs a backup when the newest automatic one is older than the interval. Checked every 10 minutes. */
export async function backupIfDue(): Promise<Manifest | null> {
  const cfg = await getSettings();
  if (!cfg.backup_enabled || backupBusy()) return null;
  const { items } = await listBackups();
  const last = items.find((b) => b.reason === "auto");
  if (last && last.created_at > now() - cfg.backup_interval_hours * 3600 + 300) return null;
  return createBackup("auto");
}

const gt = globalThis as unknown as { __wikiBackupTimer?: ReturnType<typeof setInterval> };
export function startBackupJob() {
  if (gt.__wikiBackupTimer) return;
  const tick = () => backupIfDue().catch((e: unknown) => console.error("[backup]", e instanceof Error ? e.message : e));
  setTimeout(() => void tick(), 60_000).unref(); // not during start-up
  gt.__wikiBackupTimer = setInterval(() => void tick(), 600_000);
  gt.__wikiBackupTimer.unref();
}

/** Checks the configured target: write, read back, delete one small test object. */
export async function testBackupTarget(st?: BackupStore) {
  const s = st ?? (await backupStore());
  const work = scratchDir();
  try {
    const probe = "0".repeat(64);
    const f = path.join(/* turbopackIgnore: true */ work, "probe");
    await pipeline(Readable.from([Buffer.from("tidewiki")]), encryptStream("object", probe), createWriteStream(f));
    await s.put(`v2/objects/${probe}`, f);
    const back: Buffer[] = [];
    for await (const c of await s.get(`v2/objects/${probe}`)) back.push(c as Buffer);
    await s.delete(`v2/objects/${probe}`);
    const plain = await openBuffer("object", probe, Buffer.concat(back));
    if (plain.toString() !== "tidewiki") throw new HttpError(502, "The backup storage returned different data.");
    return { ok: true, where: s.describe() };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export { KEY_RE };
