import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";
import { loadMasterKey } from "./crypto";

/*
 * Encryption of everything that leaves the database as a backup.
 *
 * Keys
 *   root   = HKDF-SHA256(master key, salt "tidewiki/backup", info "root/v1")
 *   file   = HKDF-SHA256(root, salt = 16 random bytes per file, info "file/v1")
 *   naming = HKDF-SHA256(root, salt "tidewiki/backup", info "object-names/v1")
 * A random per-file key means nonces can be plain counters and never repeat under one key.
 *
 * File format ("TWB1")
 *   header: magic "TWB1" | version 1 | kind (1 = manifest, 2 = data, 3 = object) | id length | id | salt(16) | chunk size (u32 BE)
 *   then chunks: AES-256-GCM(plaintext ≤ chunk size) || tag(16)
 *   nonce of chunk i = 7 zero bytes | i (u32 BE) | last-flag (1 on the final chunk, else 0)
 *   AAD of every chunk = the complete header
 * This is the STREAM construction (Hoang, Reyhanitabar, Rogaway, Vizár 2015): a chunk can't be
 * modified, dropped, reordered, moved to another file or another backup (the id is in the AAD),
 * and cutting the file short is detected because the final chunk carries the last-flag.
 *
 * Deliberately no compression: compressing attacker-chosen text (a self-chosen user name, page
 * content) next to secrets (password hashes) would let the ciphertext length leak information.
 */

const MAGIC = Buffer.from("TWB1");
export const CHUNK = 64 * 1024;
export type Kind = "manifest" | "data" | "object";
const KIND_CODE: Record<Kind, number> = { manifest: 1, data: 2, object: 3 };
const TAG = 16;

let root: Buffer | null = null;
const rootKey = () =>
  (root ??= Buffer.from(
    hkdfSync("sha256", loadMasterKey(), Buffer.from("tidewiki/backup"), Buffer.from("root/v1"), 32),
  ));
const fileKey = (salt: Buffer) => Buffer.from(hkdfSync("sha256", rootKey(), salt, Buffer.from("file/v1"), 32));

/** Only for tests that switch the master key. */
export const resetBackupKeys = () => {
  root = null;
};

/** Storage name of a media object: keyed hash of its SHA-256, so the store can't confirm known files. */
export function objectName(contentSha256: Buffer): string {
  const k = Buffer.from(
    hkdfSync("sha256", rootKey(), Buffer.from("tidewiki/backup"), Buffer.from("object-names/v1"), 32),
  );
  return createHmac("sha256", k).update(contentSha256).digest("hex");
}

function header(kind: Kind, id: string, salt: Buffer): Buffer {
  const idb = Buffer.from(id, "utf8");
  if (idb.length > 200) throw new Error("backup id too long");
  const h = Buffer.alloc(4 + 1 + 1 + 1 + idb.length + 16 + 4);
  let o = MAGIC.copy(h, 0);
  h[o++] = 1;
  h[o++] = KIND_CODE[kind];
  h[o++] = idb.length;
  o += idb.copy(h, o);
  o += salt.copy(h, o);
  h.writeUInt32BE(CHUNK, o);
  return h;
}

const nonce = (i: number, last: boolean) => {
  const n = Buffer.alloc(12);
  n.writeUInt32BE(i, 7);
  n[11] = last ? 1 : 0;
  return n;
};

/** Encrypting transform: plaintext in, TWB1 file out. */
export function encryptStream(kind: Kind, id: string): Transform {
  const salt = randomBytes(16);
  const key = fileKey(salt);
  const aad = header(kind, id, salt);
  let buf: Buffer = Buffer.alloc(0);
  let i = 0;
  const seal = (pt: Buffer, last: boolean) => {
    if (i >= 0xffffffff) throw new Error("backup file too large");
    const c = createCipheriv("aes-256-gcm", key, nonce(i++, last));
    c.setAAD(aad);
    return Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
  };
  const t = new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      try {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        // hold back up to one chunk: only at the end do we know which chunk is the last one
        while (buf.length > CHUNK) {
          this.push(seal(buf.subarray(0, CHUNK), false));
          buf = buf.subarray(CHUNK);
        }
        cb();
      } catch (e) {
        cb(e as Error);
      }
    },
    flush(cb) {
      try {
        this.push(seal(buf, true));
        cb();
      } catch (e) {
        cb(e as Error);
      }
    },
  });
  t.push(aad);
  return t;
}

export class BackupIntegrityError extends Error {}

/**
 * Decrypting transform. Refuses anything that isn't exactly the expected kind and id, any
 * modified chunk, missing final chunk or trailing data — before releasing the bad chunk.
 */
export function decryptStream(kind: Kind, id: string): Transform {
  let buf: Buffer = Buffer.alloc(0);
  let key: Buffer | null = null;
  let aad: Buffer | null = null;
  let i = 0;
  let finished = false;
  const fail = (m: string) => new BackupIntegrityError(m);
  const open = (ct: Buffer, last: boolean) => {
    const c = createDecipheriv("aes-256-gcm", key!, nonce(i++, last));
    c.setAAD(aad!);
    c.setAuthTag(ct.subarray(ct.length - TAG));
    return Buffer.concat([c.update(ct.subarray(0, ct.length - TAG)), c.final()]);
  };
  const step = (push: (b: Buffer) => void, eof: boolean) => {
    if (!aad) {
      const idb = Buffer.from(id, "utf8");
      const need = 4 + 3 + idb.length + 16 + 4;
      if (buf.length < need) {
        if (eof) throw fail("truncated header");
        return;
      }
      const h = buf.subarray(0, need);
      if (!h.subarray(0, 4).equals(MAGIC) || h[4] !== 1) throw fail("not a Tidewiki backup file");
      if (h[5] !== KIND_CODE[kind] || h[6] !== idb.length || !h.subarray(7, 7 + idb.length).equals(idb))
        throw fail("file belongs to another backup");
      if (h.readUInt32BE(need - 4) !== CHUNK) throw fail("unsupported chunk size");
      aad = Buffer.from(h);
      key = fileKey(Buffer.from(h.subarray(7 + idb.length, 7 + idb.length + 16)));
      buf = buf.subarray(need);
    }
    const full = CHUNK + TAG;
    // only a full-size chunk with more data behind it is certainly not the last one
    while (buf.length > full) {
      if (finished) throw fail("data after the final chunk");
      push(open(buf.subarray(0, full), false));
      buf = buf.subarray(full);
    }
    if (eof) {
      if (finished) {
        if (buf.length) throw fail("data after the final chunk");
        return;
      }
      if (buf.length < TAG) throw fail("truncated");
      try {
        push(open(buf, true));
      } catch {
        throw fail("truncated or modified");
      }
      buf = Buffer.alloc(0);
      finished = true;
    }
  };
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      try {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        step((b) => this.push(b), false);
        cb();
      } catch (e) {
        cb(e instanceof BackupIntegrityError ? e : fail("modified (authentication failed)"));
      }
    },
    flush(cb) {
      try {
        step((b) => this.push(b), true);
        cb();
      } catch (e) {
        cb(e instanceof BackupIntegrityError ? e : fail("modified (authentication failed)"));
      }
    },
  });
}

/** Whole-buffer helpers for the small manifest. */
export async function sealBuffer(kind: Kind, id: string, plain: Buffer): Promise<Buffer> {
  const out: Buffer[] = [];
  const e = encryptStream(kind, id);
  e.on("data", (b: Buffer) => out.push(b));
  await new Promise<void>((res, rej) => {
    e.on("end", res);
    e.on("error", rej);
    e.end(plain);
  });
  return Buffer.concat(out);
}
export async function openBuffer(kind: Kind, id: string, sealed: Buffer): Promise<Buffer> {
  const out: Buffer[] = [];
  const d = decryptStream(kind, id);
  d.on("data", (b: Buffer) => out.push(b));
  await new Promise<void>((res, rej) => {
    d.on("end", res);
    d.on("error", rej);
    d.end(sealed);
  });
  return Buffer.concat(out);
}

export const sha256Buf = (b: Buffer) => createHash("sha256").update(b).digest();
