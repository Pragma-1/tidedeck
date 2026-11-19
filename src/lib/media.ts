import { randomBytes } from "node:crypto";
import { waitForDrain } from "./stream-util";
import {
  createWriteStream,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";
import { all, one, run, sql, now, tx, wipe } from "./db";
import { HttpError } from "./validate";

export const MEDIA_DIR = () => path.join(/* turbopackIgnore: true */ DATA_DIR, "media");
const MB = 1024 * 1024;
const envMb = (k: string, d: number) => {
  const n = Number.parseInt(process.env[k] || "", 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};
export const LIMITS = {
  image: 15 * MB,
  video: envMb("WIKI_MAX_VIDEO_MB", 200) * MB,
  quota: envMb("WIKI_MEDIA_QUOTA_MB", 10240) * MB,
};

type Kind = "image" | "video";
export type Sniffed = { mime: string; ext: string; kind: Kind };
export type MediaRow = {
  id: number;
  name: string;
  mime: string;
  kind: Kind;
  size: number;
  original_name: string | null;
  created_by: number | null;
  created_at: number;
};

/** Identifies a file by its first bytes. Only these types are ever accepted (no SVG: it can carry script). */
export function sniff(b: Buffer): Sniffed | null {
  const at = (o: number, s: string) => b.length >= o + s.length && b.toString("latin1", o, o + s.length) === s;
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { mime: "image/png", ext: "png", kind: "image" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return { mime: "image/jpeg", ext: "jpg", kind: "image" };
  if (at(0, "GIF87a") || at(0, "GIF89a")) return { mime: "image/gif", ext: "gif", kind: "image" };
  if (at(0, "RIFF") && at(8, "WEBP")) return { mime: "image/webp", ext: "webp", kind: "image" };
  if (at(4, "ftyp")) {
    const brand = b.toString("latin1", 8, 12);
    if (brand === "qt  ") return { mime: "video/quicktime", ext: "mov", kind: "video" };
    if (/^(isom|iso[2-9]|mp4[12]|avc1|M4V |M4VP|dash|mmp4|MSNV|f4v )$/.test(brand))
      return { mime: "video/mp4", ext: "mp4", kind: "video" };
    return null; // HEIC/AVIF and other ISO-BMFF types are not accepted
  }
  if (b.length >= 4 && b.readUInt32BE(0) === 0x1a45dfa3 && b.subarray(0, 64).includes(Buffer.from("webm")))
    return { mime: "video/webm", ext: "webm", kind: "video" };
  if (at(0, "OggS")) return { mime: "video/ogg", ext: "ogv", kind: "video" };
  return null;
}

const bad = (): never => {
  throw new HttpError(415, "This file is damaged or not a supported image.");
};

/* ---------------------------------------------------------------- metadata */

function exifOrientation(payload: Buffer): number | null {
  if (payload.length < 14 || payload.toString("latin1", 0, 6) !== "Exif\0\0") return null;
  const t = payload.subarray(6);
  const le = t.toString("latin1", 0, 2) === "II";
  if (!le && t.toString("latin1", 0, 2) !== "MM") return null;
  const u16 = (o: number) => (o + 2 <= t.length ? (le ? t.readUInt16LE(o) : t.readUInt16BE(o)) : -1);
  const u32 = (o: number) => (o + 4 <= t.length ? (le ? t.readUInt32LE(o) : t.readUInt32BE(o)) : -1);
  if (u16(2) !== 42) return null;
  const ifd = u32(4),
    count = u16(ifd);
  if (ifd < 8 || count < 0 || count > 500) return null;
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (u16(e) === 0x0112 && u16(e + 2) === 3) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** A minimal APP1 that carries nothing but the orientation, so phone photos aren't shown sideways. */
function orientationSegment(o: number): Buffer {
  const tiff = Buffer.from([
    0x49,
    0x49,
    0x2a,
    0x00,
    0x08,
    0,
    0,
    0,
    0x01,
    0x00,
    0x12,
    0x01,
    0x03,
    0x00,
    0x01,
    0,
    0,
    0,
    o,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** JPEG: keep only what decoding needs (JFIF, ICC profile, Adobe colour info, tables, image data). */
export function stripJpeg(b: Buffer): Buffer {
  if (b[0] !== 0xff || b[1] !== 0xd8) bad();
  const kept: Buffer[] = [];
  let i = 2,
    orientation: number | null = null,
    app0: Buffer | null = null;
  for (;;) {
    if (i + 4 > b.length) bad();
    if (b[i] !== 0xff) bad();
    const m = b[i + 1];
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m === 0xd9) bad(); // EOI before any image data
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      kept.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) bad();
    const seg = b.subarray(i, i + 2 + len),
      body = seg.subarray(4);
    if (m === 0xda) {
      // Entropy-coded data can't contain FF D9 (0xFF is always stuffed), so the first EOI ends the image.
      // Everything after it (MPF secondary images, vendor trailers with their own EXIF) is dropped.
      const eoi = b.indexOf(Buffer.from([0xff, 0xd9]), i + 2 + len);
      if (eoi < 0) bad();
      kept.push(b.subarray(i, eoi + 2));
      break;
    }
    if (m === 0xe1) {
      orientation = exifOrientation(body) ?? orientation;
    } else if (m === 0xe0 && !app0) app0 = seg;
    else if (m === 0xe2) {
      if (body.toString("latin1", 0, 12) === "ICC_PROFILE\0") kept.push(seg);
    } else if (m === 0xee)
      kept.push(seg); // Adobe: needed for CMYK/YCCK colour
    else if (m >= 0xe0 && m <= 0xef) {
      /* other APPn: metadata */
    } else if (m === 0xfe) {
      /* comment */
    } else kept.push(seg); // DQT, DHT, SOFn, DRI, …
    i += 2 + len;
  }
  return Buffer.concat([
    b.subarray(0, 2),
    ...(app0 ? [app0] : []),
    ...(orientation && orientation !== 1 ? [orientationSegment(orientation)] : []),
    ...kept,
  ]);
}

/** PNG: drop text, EXIF and timestamp chunks and anything after IEND. */
export function stripPng(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 8)];
  let i = 8,
    sawEnd = false;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i),
      type = b.toString("latin1", i + 4, i + 8);
    if (len > b.length || i + 12 + len > b.length || !/^[A-Za-z]{4}$/.test(type)) bad();
    if (!["tEXt", "zTXt", "iTXt", "eXIf", "tIME"].includes(type)) out.push(b.subarray(i, i + 12 + len));
    i += 12 + len;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) bad();
  return Buffer.concat(out);
}

/** WebP: drop EXIF/XMP chunks and clear their flags in VP8X. */
export function stripWebp(b: Buffer): Buffer {
  const total = Math.min(b.readUInt32LE(4) + 8, b.length);
  const chunks: Buffer[] = [];
  let i = 12;
  while (i + 8 <= total) {
    const id = b.toString("latin1", i, i + 4),
      len = b.readUInt32LE(i + 4);
    const end = i + 8 + len + (len & 1);
    if (len > total || end > total + 1) bad();
    if (id !== "EXIF" && id !== "XMP ") {
      const c = Buffer.from(b.subarray(i, Math.min(end, total)));
      if (id === "VP8X" && c.length > 8) c[8] &= ~0x0c;
      chunks.push(c);
    }
    i = end;
  }
  if (!chunks.length) bad();
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length + 4, 4);
  head.write("WEBP", 8, "latin1");
  return Buffer.concat([head, body]);
}

/** GIF: drop comment blocks and application blocks other than animation looping; stop at the trailer. */
export function stripGif(b: Buffer): Buffer {
  if (b.length < 13) bad();
  let i = 13;
  if (b[10] & 0x80) i += 3 * 2 ** ((b[10] & 7) + 1);
  const out: Buffer[] = [b.subarray(0, i)];
  const subBlocks = (from: number) => {
    let j = from;
    while (j < b.length && b[j] !== 0) j += b[j] + 1;
    if (j >= b.length) bad();
    return j + 1;
  };
  for (;;) {
    if (i >= b.length) bad();
    const t = b[i];
    if (t === 0x3b) {
      out.push(Buffer.from([0x3b]));
      break;
    }
    if (t === 0x21) {
      const label = b[i + 1],
        end = subBlocks(i + 2);
      const app = label === 0xff ? b.toString("latin1", i + 3, i + 14) : "";
      if (label !== 0xfe && !(label === 0xff && !/^(NETSCAPE2\.0|ANIMEXTS1\.0)$/.test(app)))
        out.push(b.subarray(i, end));
      i = end;
    } else if (t === 0x2c) {
      let j = i + 10;
      if (j > b.length) bad();
      if (b[i + 9] & 0x80) j += 3 * 2 ** ((b[i + 9] & 7) + 1);
      const end = subBlocks(j + 1);
      out.push(b.subarray(i, end));
      i = end;
    } else bad();
  }
  return Buffer.concat(out);
}

export function stripImage(b: Buffer, ext: string): Buffer {
  switch (ext) {
    case "jpg":
      return stripJpeg(b);
    case "png":
      return stripPng(b);
    case "webp":
      return stripWebp(b);
    case "gif":
      return stripGif(b);
    default:
      return bad();
  }
}

/* ------------------------------------------------------------------ store */

const usedBytes = async () => (await one<{ n: number }>(sql`SELECT COALESCE(SUM(size), 0) AS n FROM media`))?.n ?? 0;
const cleanName = (s: string | null) =>
  s
    ? s
        .normalize("NFKC")
        .replace(/[\u0000-\u001f\u007f<>"'`\\/]/g, "")
        .trim()
        .slice(0, 120) || null
    : null;

/** Streams an upload to disk with a hard size cap, identifies it, strips image metadata, then stores it. */
const running = { total: 0, perUser: new Map<number, number>() };

/** At most 2 uploads per person and 4 overall at the same time (disk and memory stay predictable). */
export async function storeUpload(
  stream: ReadableStream<Uint8Array>,
  declared: number,
  originalName: string | null,
  userId: number,
): Promise<MediaRow> {
  const mine = running.perUser.get(userId) ?? 0;
  if (mine >= 2 || running.total >= 4)
    throw new HttpError(429, "Too many uploads at once. Wait for the current ones to finish.");
  running.total++;
  running.perUser.set(userId, mine + 1);
  try {
    return await storeUploadInner(stream, declared, originalName, userId);
  } finally {
    running.total--;
    const n = (running.perUser.get(userId) ?? 1) - 1;
    if (n > 0) running.perUser.set(userId, n);
    else running.perUser.delete(userId);
  }
}

async function storeUploadInner(
  stream: ReadableStream<Uint8Array>,
  declared: number,
  originalName: string | null,
  userId: number,
): Promise<MediaRow> {
  const dir = MEDIA_DIR();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (declared > LIMITS.video) throw new HttpError(413, "This file is too large.");
  if ((await usedBytes()) + Math.max(declared, 0) > LIMITS.quota)
    throw new HttpError(507, "The media storage is full. Ask an administrator to delete unused files.");
  const tmp = path.join(/* turbopackIgnore: true */ dir, `.upload-${randomBytes(9).toString("hex")}`);
  const out = createWriteStream(tmp, { mode: 0o600 });
  let writeError: Error | null = null;
  out.on("error", (e) => {
    writeError = e;
  }); // never leave a stream error unhandled (it would crash the process)
  const reader = stream.getReader();
  let size = 0,
    head = Buffer.alloc(0),
    type: Sniffed | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (!type) {
        head = Buffer.concat([head, value]);
        if (head.length >= 64 || size > 64) {
          type = sniff(head);
          if (!type)
            throw new HttpError(
              415,
              "Only PNG, JPEG, GIF and WebP images and MP4, WebM or Ogg videos can be uploaded.",
            );
        }
      }
      if (size > (type ? LIMITS[type.kind] : LIMITS.video)) throw new HttpError(413, "This file is too large.");
      if (writeError) throw new HttpError(500, "Something went wrong on the server.");
      if (!out.write(value)) await waitForDrain(out);
    }
    await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));
    type ??= sniff(head);
    if (!type || size === 0)
      throw new HttpError(415, "Only PNG, JPEG, GIF and WebP images and MP4, WebM or Ogg videos can be uploaded.");
    const name = `${randomBytes(16).toString("base64url")}.${type.ext}`;
    const final = path.join(/* turbopackIgnore: true */ dir, name);
    if (type.kind === "image") {
      writeFileSync(final, stripImage(readFileSync(tmp), type.ext), { mode: 0o600 });
      rmSync(tmp, { force: true });
    } else renameSync(tmp, final);
    const stored = statSync(final).size;
    try {
      return (await one<MediaRow>(
        sql`INSERT INTO media(name, mime, kind, size, original_name, created_by, created_at)
            VALUES (${name}, ${type.mime}, ${type.kind}, ${stored}, ${cleanName(originalName)}, ${userId}, ${now()})
            RETURNING *`,
      ))!;
    } catch (e) {
      rmSync(final, { force: true }); // no row, no file
      throw e;
    }
  } catch (e) {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    out.destroy();
    rmSync(tmp, { force: true });
    throw e;
  }
}

export const getMediaByName = (name: string) => one<MediaRow>(sql`SELECT * FROM media WHERE name = ${name}`);

/** A stored file name as it appears in page text (`/media/<name>`). */
const NAME_IN_TEXT = "/media/([A-Za-z0-9_-]{16,40}[.](?:png|jpg|gif|webp|mp4|webm|ogv|mov))";
const FILE_NAME = /^[A-Za-z0-9_-]{16,40}\.(?:png|jpg|gif|webp|mp4|webm|ogv|mov)$/;

export type ListedMedia = MediaRow & {
  username: string | null;
  /** pages showing it now */
  used_in: number;
  /** deleted pages in the trash that show it (they'd show a gap after a restore) */
  in_trash: number;
  /** only older versions of pages show it */
  in_history: boolean;
};

/**
 * Every file with where it is used. Each text is scanned once for /media/… references (not once
 * per file), so this stays quick with many files and long histories.
 */
export async function listMedia(): Promise<ListedMedia[]> {
  return all<ListedMedia>(
    sql`WITH cur AS (
          SELECT m[1] AS name, COUNT(DISTINCT p.id) AS n
          FROM pages p, regexp_matches(p.content, ${NAME_IN_TEXT}, 'g') m GROUP BY m[1]
        ), bin AS (
          SELECT m[1] AS name, COUNT(DISTINCT t.id) AS n
          FROM trash t, regexp_matches(t.content, ${NAME_IN_TEXT}, 'g') m GROUP BY m[1]
        ), hist AS (
          SELECT DISTINCT m[1] AS name FROM page_revisions r, regexp_matches(r.content, ${NAME_IN_TEXT}, 'g') m
          UNION
          SELECT DISTINCT m[1] FROM trash_revisions r, regexp_matches(r.content, ${NAME_IN_TEXT}, 'g') m
        )
        SELECT m.*, u.username, COALESCE(cur.n, 0) AS used_in, COALESCE(bin.n, 0) AS in_trash,
               (hist.name IS NOT NULL AND cur.n IS NULL AND bin.n IS NULL) AS in_history
        FROM media m
        LEFT JOIN users u ON u.id = m.created_by
        LEFT JOIN cur ON cur.name = m.name
        LEFT JOIN bin ON bin.name = m.name
        LEFT JOIN hist ON hist.name = m.name
        ORDER BY m.id DESC`,
  );
}

/** Removes the files of deleted rows from disk, then the rows from the database files (see wipe). */
async function removeFiles(rows: MediaRow[]) {
  for (const m of rows)
    if (FILE_NAME.test(m.name)) rmSync(path.join(/* turbopackIgnore: true */ MEDIA_DIR(), m.name), { force: true });
  if (rows.length) await wipe(["media"]);
}

/**
 * Deletes files for good: the database row, the file on disk, and the row's traces in the
 * database files. Uploaders may delete their own files, administrators any. All or nothing.
 */
export async function deleteMediaMany(ids: number[], actor: { id: number; role: string }): Promise<MediaRow[]> {
  const rows = await tx(async () => {
    const found = await all<MediaRow>(sql`SELECT * FROM media WHERE id = ANY(${ids}::bigint[]) FOR UPDATE`);
    if (actor.role !== "admin" && found.some((m) => m.created_by !== actor.id))
      throw new HttpError(403, "Only the uploader or an administrator can delete this file.");
    await deleteRows(found.map((m) => m.id));
    return found;
  });
  await removeFiles(rows);
  return rows;
}
const deleteRows = (ids: number[]) => run(sql`DELETE FROM media WHERE id = ANY(${ids}::bigint[])`);

export async function deleteMedia(id: number, actor: { id: number; role: string }) {
  const [m] = await deleteMediaMany([id], actor);
  if (!m) throw new HttpError(404, "File not found.");
  return m;
}

/**
 * Deletes every file no page and no page in the trash shows (files only older versions show are
 * deleted too — those versions then show a gap). Also removes stray files on disk that have no
 * entry (left over by a crash) and abandoned partial uploads. Administrators only.
 */
export async function deleteUnusedMedia(): Promise<{ files: MediaRow[]; strays: number; bytes: number }> {
  const unused = (await listMedia()).filter((m) => m.used_in === 0 && m.in_trash === 0).map((m) => m.id);
  const files = unused.length
    ? await tx(async () => {
        // checked again under the lock: a page saved meanwhile may use one of them now
        const rows = await all<MediaRow>(
          sql`SELECT * FROM media m WHERE m.id = ANY(${unused}::bigint[])
                AND NOT EXISTS (SELECT 1 FROM pages p WHERE strpos(p.content, '/media/' || m.name) > 0)
                AND NOT EXISTS (SELECT 1 FROM trash t WHERE strpos(t.content, '/media/' || m.name) > 0)
              FOR UPDATE`,
        );
        if (rows.length) await deleteRows(rows.map((r) => r.id));
        return rows;
      })
    : [];
  await removeFiles(files);
  const strays = await sweepMediaDir();
  return { files, strays: strays.count, bytes: files.reduce((a, m) => a + m.size, 0) + strays.bytes };
}

/**
 * Files in the media folder that nothing points to: a file without a database entry (older than
 * 10 minutes, so an upload in progress is never touched), an abandoned partial upload (older than
 * an hour). Called by "delete unused" and the hourly job.
 */
export async function sweepMediaDir(): Promise<{ count: number; bytes: number }> {
  const dir = MEDIA_DIR();
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return { count: 0, bytes: 0 };
  }
  const known = new Set((await all<{ name: string }>(sql`SELECT name FROM media`)).map((r) => r.name));
  const nowMs = Date.now();
  let count = 0,
    bytes = 0;
  for (const n of names) {
    const f = path.join(/* turbopackIgnore: true */ dir, n);
    let st;
    try {
      st = lstatSync(f);
    } catch {
      continue;
    }
    if (!st.isFile()) continue; // folders (.import) and links are never touched
    const age = nowMs - st.mtimeMs;
    const stray =
      (FILE_NAME.test(n) && !known.has(n) && age > 10 * 60_000) || (n.startsWith(".upload-") && age > 3600_000);
    if (!stray) continue;
    rmSync(f, { force: true });
    count++;
    bytes += st.size;
  }
  return { count, bytes };
}

export const mediaUsage = async () => ({ used: await usedBytes(), quota: LIMITS.quota });
