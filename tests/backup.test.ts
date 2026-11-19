import "./setup-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { zipSync, strToU8, unzipSync } from "fflate";
import { SignatureV4 } from "@smithy/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { HttpRequest } from "@smithy/protocol-http";
import * as auth from "@/lib/auth";
import { createUser, deleteUser, eraseOwnAccount } from "@/lib/admin";
import { createPage, getPage, getRevision, listRevisions, updatePage } from "@/lib/pages";
import { listTrash, trashPage } from "@/lib/trash";
import { MEDIA_DIR } from "@/lib/media";
import { getSettings, updateSettings } from "@/lib/settings";
import { CHUNK, openBuffer, sealBuffer, resetBackupKeys } from "@/lib/backup-crypto";
import { resetMasterKeyForTests } from "@/lib/crypto";
import { checkLocalDir, checkS3Config, LocalStore, S3Store, signV4 } from "@/lib/backup-store";
import { DATA_DIR } from "@/lib/config";
import {
  backupIfDue,
  backupRoots,
  checkBackupDir,
  backupZipStream,
  createBackup,
  deleteBackup,
  getManifest,
  importBackupZip,
  listBackups,
  restoreBackup,
  restorePage,
  restoreUser,
  setStoreForTests,
  testBackupTarget,
  verifyBackup,
} from "@/lib/backup";
import { db } from "./pg";
import { startFakeS3 } from "./s3-fake";

const PW = "tidal-marsh-lantern-47";
const scratch = mkdtempSync(path.join(tmpdir(), "tw-bk-"));
const storeDir = path.join(scratch, "store");
let owner = 0,
  admin = 0,
  editor = 0;
const ownerU = () => ({ id: owner, isOwner: true });
const adminU = () => ({ id: admin, isOwner: false });

function addMedia(): string {
  const name = `${randomBytes(16).toString("base64url")}.png`;
  mkdirSync(MEDIA_DIR(), { recursive: true });
  writeFileSync(path.join(MEDIA_DIR(), name), Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), randomBytes(64)]));
  return name;
}
async function registerMedia(name: string) {
  await db()
    .prepare("INSERT INTO media(name,mime,kind,size,original_name,created_by,created_at) VALUES(?,?,?,?,?,?,?)")
    .run(name, "image/png", "image", 72, "x.png", owner, 1);
}
const allFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((f) =>
        f.isDirectory() ? allFiles(path.join(dir, f.name)) : [path.join(dir, f.name)],
      )
    : [];
async function toBuffer(s: ReadableStream<Uint8Array>) {
  const out: Buffer[] = [];
  const r = s.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    out.push(Buffer.from(value));
  }
  return Buffer.concat(out);
}

beforeAll(async () => {
  owner = await auth.setupAdmin((await auth.ensureSetupToken())!, "chef", "chef@example.com", PW, null);
  admin = await createUser(
    owner,
    { username: "admina", email: "admina@example.com", role: "admin", password: PW },
    null,
  );
  editor = await createUser(owner, { username: "edda", email: "edda@example.com", role: "editor", password: PW }, null);
  setStoreForTests(new LocalStore(storeDir));
});
afterAll(() => {
  setStoreForTests(undefined);
  rmSync(scratch, { recursive: true, force: true });
});

/* ======================================================================= crypto */

describe("backup encryption (chunked AES-256-GCM, STREAM)", () => {
  it("round-trips every size around the chunk boundaries", async () => {
    for (const n of [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 2 * CHUNK, 3 * CHUNK + 7]) {
      const p = randomBytes(n);
      const c = await sealBuffer("data", "20260101-000000-abcdef", p);
      expect((await openBuffer("data", "20260101-000000-abcdef", c)).equals(p)).toBe(true);
    }
  });
  it("detects every kind of tampering", async () => {
    const id = "20260101-000000-abcdef";
    const p = randomBytes(3 * CHUNK + 100);
    const c = await sealBuffer("data", id, p);
    const hdr = c.length - p.length - 4 * 16; // header length
    const bad = async (buf: Buffer, kind: "data" | "manifest" = "data", forId = id) => {
      await expect(openBuffer(kind, forId, buf)).rejects.toThrow();
    };
    for (const at of [0, 5, hdr - 1, hdr + 10, hdr + CHUNK + 20, c.length - 1]) {
      const x = Buffer.from(c);
      x[at] ^= 1;
      await bad(x); // any flipped bit: header, any chunk, any tag
    }
    await bad(c.subarray(0, hdr + 3 * (CHUNK + 16))); // the final chunk cut off at a chunk boundary
    await bad(c.subarray(0, c.length - 5)); // cut mid-chunk
    await bad(Buffer.concat([c, Buffer.from("x")])); // trailing data
    const swapped = Buffer.concat([
      c.subarray(0, hdr),
      c.subarray(hdr + CHUNK + 16, hdr + 2 * (CHUNK + 16)),
      c.subarray(hdr, hdr + CHUNK + 16),
      c.subarray(hdr + 2 * (CHUNK + 16)),
    ]);
    await bad(swapped); // chunks reordered
    await bad(c, "manifest"); // wrong kind
    await bad(c, "data", "20260101-000000-ffffff"); // another backup's id
    // a chunk moved in from another file with the same id fails too (different per-file key)
    const other = await sealBuffer("data", id, p);
    await bad(Buffer.concat([c.subarray(0, hdr), other.subarray(hdr, hdr + CHUNK + 16), c.subarray(hdr + CHUNK + 16)]));
  });
  it("can't be opened with another master key", async () => {
    const c = await sealBuffer("manifest", "20260101-000000-abcdef", Buffer.from("secret"));
    const old = process.env.WIKI_MASTER_KEY;
    process.env.WIKI_MASTER_KEY = randomBytes(48).toString("base64");
    resetMasterKeyForTests();
    resetBackupKeys();
    try {
      await expect(openBuffer("manifest", "20260101-000000-abcdef", c)).rejects.toThrow();
    } finally {
      if (old === undefined) delete process.env.WIKI_MASTER_KEY;
      else process.env.WIKI_MASTER_KEY = old;
      resetMasterKeyForTests();
      resetBackupKeys();
    }
    expect((await openBuffer("manifest", "20260101-000000-abcdef", c)).toString()).toBe("secret");
  });
});

/* ======================================================================= create */

describe("creating backups", () => {
  it("stores only ciphertext, deduplicates files, leaves out sign-ins", async () => {
    const m1 = addMedia();
    await registerMedia(m1);
    await createPage({
      title: "Geheimrezept",
      content: `Zutaten: Kardamom ![](/media/${m1})`,
      parentId: null,
      userId: owner,
    });
    await auth.createSession(owner, "full", 3600, null, null);
    const a = await createBackup("manual");
    expect(a.counts.pages).toBeGreaterThan(0);
    expect(a.media.map((x) => x.name)).toContain(m1);
    expect(a.pages.some((p) => p.title === "Geheimrezept")).toBe(true);
    // nothing readable in the store: no page text, no user name, no password hash, no file bytes
    for (const f of allFiles(storeDir)) {
      const bytes = readFileSync(f);
      for (const needle of ["Kardamom", "Geheimrezept", "chef@example.com", "$argon2id$", "IHDR"])
        expect(bytes.includes(Buffer.from(needle)), `${path.basename(f)} contains ${needle}`).toBe(false);
    }
    const objects = () => readdirSync(path.join(storeDir, "v2", "objects")).length;
    const n = objects();
    const b = await createBackup("manual");
    expect(objects()).toBe(n); // the same file isn't stored twice
    const v = await verifyBackup(b.id);
    expect(v.ok).toBe(true);
    expect(v.records.users).toBe(3);
    expect(Object.keys(v.records)).not.toContain("sessions");
    await deleteBackup(b.id);
  });

  it("refuses a second backup operation while one is running", async () => {
    const a = createBackup("manual");
    await expect(createBackup("manual")).rejects.toThrow(/Another import or backup/);
    await deleteBackup((await a).id);
  });

  it("verify notices a damaged data file; a damaged manifest makes the backup unreadable, never deleted", async () => {
    const b = await createBackup("manual");
    const f = path.join(storeDir, "v2", `${b.id}.data`);
    const orig = readFileSync(f);
    const x = Buffer.from(orig);
    x[x.length - 40] ^= 0xff;
    writeFileSync(f, x);
    await expect(verifyBackup(b.id)).rejects.toThrow(/master key|damaged/);
    await expect(restoreBackup(b.id)).rejects.toThrow(/master key|damaged/);
    writeFileSync(f, orig);
    const mf = path.join(storeDir, "v2", `${b.id}.manifest`);
    const morig = readFileSync(mf);
    const y = Buffer.from(morig);
    y[y.length - 1] ^= 1;
    writeFileSync(mf, y);
    const l = await listBackups();
    expect(l.unreadable).toBe(1);
    expect(l.items.some((i) => i.id === b.id)).toBe(false);
    // pruning with an unreadable manifest present must not garbage-collect objects
    const before = readdirSync(path.join(storeDir, "v2", "objects")).length;
    await createBackup("auto");
    expect(readdirSync(path.join(storeDir, "v2", "objects")).length).toBeGreaterThanOrEqual(before);
    writeFileSync(mf, morig);
    await deleteBackup(b.id);
    for (const i of (await listBackups()).items) if (i.reason === "auto") await deleteBackup(i.id);
  });

  it("keeps the newest automatic backups; deleting drops unreferenced files", async () => {
    await updateSettings({ backup_keep: 2, backup_interval_hours: 24, backup_enabled: true });
    for (const i of (await listBackups()).items) await deleteBackup(i.id);
    expect(readdirSync(path.join(storeDir, "v2", "objects"))).toEqual([]);
    const first = await backupIfDue();
    expect(first?.reason).toBe("auto");
    expect(await backupIfDue()).toBeNull(); // not due yet
    await createBackup("auto");
    await createBackup("auto");
    await createBackup("manual");
    const items = (await listBackups()).items;
    expect(items.filter((b) => b.reason === "auto")).toHaveLength(2);
    expect(items.map((b) => b.id)).not.toContain(first!.id);
    await updateSettings({ backup_enabled: false });
    expect(await backupIfDue()).toBeNull();
    await updateSettings({ backup_enabled: true, backup_keep: 14 });
  });
});

/* ===================================================================== restore */

describe("restoring one page", () => {
  it("adds the backup's text as a new version, or recreates a deleted page with its history and files", async () => {
    const img = addMedia();
    await registerMedia(img);
    const p = await createPage({ title: "Netzplan", content: `v1 ![](/media/${img})`, parentId: null, userId: editor });
    await updatePage(p.slug, {
      title: "Netzplan",
      content: `v2 ![](/media/${img})`,
      parentId: null,
      expectedRev: 1,
      userId: editor,
    });
    const b = await createBackup("manual");
    // later: someone overwrites the page
    await updatePage(p.slug, { title: "Netzplan", content: "kaputt", parentId: null, expectedRev: 2, userId: editor });
    const r1 = await restorePage(b.id, p.id, admin);
    expect(r1.mode).toBe("version");
    const now1 = (await getPage(p.slug))!;
    expect(now1.content).toBe(`v2 ![](/media/${img})`);
    expect(now1.rev).toBe(4); // nothing overwritten: v3 "kaputt" is still in the history
    expect((await getRevision(p.id, 3))!.content).toBe("kaputt");
    expect((await getRevision(p.id, 4))!.comment).toMatch(/^Backup /);
    await expect(restorePage(b.id, p.id, admin)).rejects.toThrow(/identical/);

    // the page is deleted for good and its image too
    await trashPage(p.slug, admin);
    await db().prepare("DELETE FROM trash").run();
    await db().prepare("DELETE FROM media WHERE name=?").run(img);
    rmSync(path.join(MEDIA_DIR(), img));
    const r2 = await restorePage(b.id, p.id, admin);
    expect(r2).toMatchObject({ mode: "recreated", slug: p.slug, files: 1 });
    expect((await listRevisions(p.id)).map((x) => x.rev)).toEqual([2, 1]); // its whole history came back
    expect(existsSync(path.join(MEDIA_DIR(), img))).toBe(true);
    expect(await db().prepare("SELECT 1 FROM media WHERE name=?").get(img)).toBeTruthy();
    await expect(restorePage(b.id, 999_999, admin)).rejects.toThrow(/isn’t in the backup/);
    await deleteBackup(b.id);
  });
});

describe("restoring one account", () => {
  it("brings back a deleted account with password, 2FA devices and authorship — never overwrites", async () => {
    const id = await createUser(
      owner,
      { username: "ruth", email: "ruth@example.com", role: "editor", password: PW },
      null,
    );
    const page = await createPage({ title: "Ruths Notizen", content: "x", parentId: null, userId: id });
    const b = await createBackup("manual");
    await expect(restoreUser(b.id, id, adminU())).rejects.toThrow(/still exists/);
    await deleteUser(owner, id, null);
    expect((await getPage(page.slug))!.created_by).toBeNull();
    const r = await restoreUser(b.id, id, adminU());
    expect(r).toMatchObject({ username: "ruth", role: "editor" });
    expect(r.relinked).toBeGreaterThan(0);
    expect((await getPage(page.slug))!.created_by).toBe(id);
    expect((await auth.attemptLogin("ruth", PW, null, null)).status).toBe("ok"); // same password as then
    expect((await auth.userById(id))!.is_owner).toBe(0);
    // administrators: only the owner may bring them back, and never as owner
    await deleteUser(owner, admin, null);
    await expect(restoreUser(b.id, admin, { id: editor, isOwner: false })).rejects.toThrow(/Only the owner/);
    await restoreUser(b.id, admin, ownerU());
    expect((await auth.userById(admin))!.role).toBe("admin");
    // the owner account still exists — and even a deleted one would come back without the owner flag
    await expect(restoreUser(b.id, owner, ownerU())).rejects.toThrow(/still exists/);
    await expect(restoreUser(b.id, 424242, ownerU())).rejects.toThrow(/isn’t in the backup/);
    await deleteBackup(b.id);
  });
});

describe("right to erasure vs. backups", () => {
  it("an account its owner erased can't be restored — not singly, not by a full restore", async () => {
    const id = await createUser(
      owner,
      { username: "gerda", email: "gerda@example.com", role: "editor", password: PW },
      null,
    );
    const b = await createBackup("manual");
    const me = { id, isOwner: false } as unknown as Parameters<typeof eraseOwnAccount>[0];
    await eraseOwnAccount(me, PW);
    await expect(restoreUser(b.id, id, ownerU())).rejects.toThrow(/right to erasure/);
    const r = await restoreBackup(b.id); // the backup still has her …
    expect(await auth.userById(id)).toBeUndefined(); // … but the erasure is applied again
    expect(await db().prepare("SELECT 1 FROM erasures WHERE user_id=?").get(id)).toBeTruthy();
    // an account an administrator deleted (not the person) can be restored
    const other = await createUser(
      owner,
      { username: "hugo", email: "hugo@example.com", role: "viewer", password: PW },
      null,
    );
    const b2 = await createBackup("manual");
    await deleteUser(owner, other, null);
    await restoreUser(b2.id, other, adminU());
    expect((await auth.userById(other))!.username).toBe("hugo");
    for (const x of [b.id, b2.id, r.safety]) await deleteBackup(x);
  });
});

describe("restoring everything", () => {
  it("replaces the wiki, signs everyone out, keeps the storage settings, and can be undone", async () => {
    const keep = addMedia();
    await registerMedia(keep);
    const p = await createPage({ title: "Vorher", content: "alt", parentId: null, userId: owner });
    const goner = await createPage({ title: "Im Papierkorb", content: "x", parentId: null, userId: owner });
    await trashPage(goner.slug, owner);
    const b = await createBackup("manual");

    const later = await createPage({ title: "Danach", content: "neu", parentId: null, userId: owner });
    const laterMedia = addMedia();
    await registerMedia(laterMedia);
    await db().prepare("DELETE FROM media WHERE name=?").run(keep);
    rmSync(path.join(MEDIA_DIR(), keep));
    await db().prepare("DELETE FROM trash").run();
    await auth.createSession(owner, "full", 3600, null, null);
    await updateSettings({ backup_keep: 7 }); // a storage/schedule setting changed after the backup

    const r = await restoreBackup(b.id);
    expect((await getPage(p.slug))?.content).toBe("alt");
    expect(await getPage(later.slug)).toBeUndefined();
    expect((await listTrash()).map((x) => x.slug)).toContain(goner.slug);
    expect(existsSync(path.join(MEDIA_DIR(), keep))).toBe(true);
    expect(existsSync(path.join(MEDIA_DIR(), laterMedia))).toBe(false);
    expect(await db().prepare("SELECT COUNT(*) n FROM sessions").get()).toEqual({ n: 0 });
    expect((await getSettings()).backup_keep).toBe(7); // where/how backups are kept is not rolled back
    expect(r.missing).toBe(0);
    const safety = await getManifest(r.safety);
    expect(safety.reason).toBe("pre-restore");
    // ids continue after the restored ones
    const fresh = await createPage({ title: "Nach Restore", content: "", parentId: null, userId: owner });
    expect(fresh.id).toBeGreaterThan(p.id);
    // … and back
    await restoreBackup(r.safety);
    expect((await getPage(later.slug))?.content).toBe("neu");
    expect(existsSync(path.join(MEDIA_DIR(), laterMedia))).toBe(true);
    expect(await getPage(fresh.slug)).toBeUndefined();
  });
});

/* ================================================================ upload/download */

describe("download and upload", () => {
  it("round-trips; foreign, modified or hostile archives are refused whole", async () => {
    const b = await createBackup("manual");
    const zip = await toBuffer(await backupZipStream(b.id));
    const files = unzipSync(new Uint8Array(zip));
    expect(Object.keys(files).sort()).toEqual(expect.arrayContaining([`${b.id}.data`, `${b.id}.manifest`]));
    // into a fresh, empty store
    const other = path.join(scratch, "other-store");
    setStoreForTests(new LocalStore(other));
    try {
      const f = path.join(scratch, "rt.zip");
      writeFileSync(f, zip);
      const up = await importBackupZip(f);
      expect(up.id).toBe(b.id);
      expect((await verifyBackup(b.id)).ok).toBe(true);
      await expect(importBackupZip(f)).rejects.toThrow(/already in the list/);

      const write = (name: string, entries: Record<string, Uint8Array>) => {
        const p = path.join(scratch, name);
        writeFileSync(p, zipSync(entries));
        return p;
      };
      const d = files[`${b.id}.data`],
        m = files[`${b.id}.manifest`];
      const tampered = Buffer.from(d);
      tampered[tampered.length - 20] ^= 1;
      const otherId = "20200101-000000-aaaaaa";
      for (const [label, entries] of Object.entries({
        traversal: { [`${b.id}.data`]: d, [`${b.id}.manifest`]: m, "../evil": strToU8("x") },
        stray: { [`${b.id}.data`]: d, [`${b.id}.manifest`]: m, "notes.txt": strToU8("x") },
        objectName: { [`${b.id}.data`]: d, [`${b.id}.manifest`]: m, "objects/../../x": strToU8("x") },
        modified: { [`${b.id}.data`]: tampered, [`${b.id}.manifest`]: m },
        renamed: { [`${otherId}.data`]: d, [`${otherId}.manifest`]: m }, // the id is authenticated
        twoBackups: { [`${b.id}.data`]: d, [`${b.id}.manifest`]: m, [`${otherId}.manifest`]: m },
        empty: {},
      } as Record<string, Record<string, Uint8Array>>)) {
        setStoreForTests(new LocalStore(path.join(scratch, `s-${label}`)));
        await expect(importBackupZip(write(`${label}.zip`, entries)), label).rejects.toThrow();
      }
      const garbage = path.join(scratch, "garbage.zip");
      writeFileSync(garbage, "not a zip");
      await expect(importBackupZip(garbage)).rejects.toThrow();
    } finally {
      setStoreForTests(new LocalStore(storeDir));
    }
    await deleteBackup(b.id);
    expect(readdirSync(path.join(storeDir, "v2")).filter((x) => x.startsWith(b.id))).toEqual([]);
  });
});

/* ========================================================================== S3 */

describe("S3", () => {
  it("signs requests exactly like AWS's reference signer", async () => {
    const date = new Date("2026-03-04T05:06:07Z");
    const input = {
      method: "PUT",
      host: "s3.eu-central-1.amazonaws.com",
      path: "/my-bucket/tidewiki/v2/20260101-000000-abcdef.data",
      query: { "x-id": "PutObject", a: "b c" },
      headers: { "content-length": "11" },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      region: "eu-central-1",
      accessKey: "AKIDEXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      date,
    };
    const ours = signV4(input);
    const ref = await new SignatureV4({
      credentials: { accessKeyId: input.accessKey, secretAccessKey: input.secretKey },
      region: input.region,
      service: "s3",
      sha256: Sha256,
      uriEscapePath: false,
      applyChecksum: false,
    }).sign(
      new HttpRequest({
        method: input.method,
        hostname: input.host,
        path: input.path,
        query: input.query,
        headers: {
          host: input.host,
          "content-length": "11",
          "x-amz-content-sha256": input.payloadHash,
          "x-amz-date": ours["x-amz-date"],
        },
      }),
      { signingDate: date },
    );
    expect(ours.authorization).toBe(ref.headers.authorization);
  });

  it("validates the configuration and refuses metadata addresses", async () => {
    const base = {
      endpoint: "https://s3.example.org",
      region: "eu-1",
      bucket: "wiki",
      prefix: "tw/",
      accessKey: "a",
      secretKey: "s",
      pathStyle: true,
    };
    expect(() => checkS3Config(base)).not.toThrow();
    for (const bad of [
      { endpoint: "ftp://x" },
      { endpoint: "https://user:pw@s3.example.org" },
      { endpoint: "https://s3.example.org/path" },
      { endpoint: "https://s3.example.org/?x=1" },
      { bucket: "../etc" },
      { bucket: "UPPER" },
      { region: "eu central" },
      { prefix: "../" },
      { prefix: "no-slash" },
      { accessKey: "" },
      { secretKey: "" },
    ])
      expect(() => checkS3Config({ ...base, ...bad }), JSON.stringify(bad)).toThrow();
    const meta = new S3Store({ ...base, endpoint: "http://169.254.169.254" });
    await expect(meta.list("v2/")).rejects.toThrow(/not allowed/);
  });

  it("backs up to and restores from S3 (paged listing, signed requests, ciphertext only)", async () => {
    const s3 = await startFakeS3({
      bucket: "wiki-backups",
      access: "AKTEST",
      secret: "s3cr3t/key+x",
      region: "eu-1",
      pageSize: 2,
    });
    try {
      const cfg = {
        endpoint: s3.url,
        region: "eu-1",
        bucket: "wiki-backups",
        prefix: "tidewiki/",
        accessKey: "AKTEST",
        secretKey: "s3cr3t/key+x",
        pathStyle: true,
      };
      const store = new S3Store(cfg);
      expect((await testBackupTarget(store)).ok).toBe(true);
      setStoreForTests(store);
      const p = await createPage({ title: "Wolkig", content: "Inhalt im Eimer", parentId: null, userId: owner });
      const a = await createBackup("manual");
      await createBackup("manual");
      await createBackup("manual");
      expect((await listBackups()).items.length).toBe(3); // three manifests over two listing pages
      expect(s3.requests.every((r) => r.ok)).toBe(true); // every request passed the reference signature check
      for (const v of s3.objects.values()) expect(v.includes(Buffer.from("Inhalt im Eimer"))).toBe(false);
      await updatePage(p.slug, { title: "Wolkig", content: "geändert", parentId: null, expectedRev: 1, userId: owner });
      await restorePage(a.id, p.id, admin);
      expect((await getPage(p.slug))!.content).toBe("Inhalt im Eimer");
      expect((await verifyBackup(a.id)).ok).toBe(true);
      // wrong secret → refused by the server, reported, nothing changes
      const wrong = new S3Store({ ...cfg, secretKey: "nope" });
      await expect(wrong.list("v2/")).rejects.toThrow(/refused/);
    } finally {
      setStoreForTests(new LocalStore(storeDir));
      await s3.close();
    }
  });
});

/* ================================================================ local folder */

describe("backup folder chosen in the settings", () => {
  const roots = () => [path.join(scratch, "nas")];
  const check = (p: unknown) => checkLocalDir(p, { roots: roots(), avoid: [DATA_DIR, process.cwd()] });

  it("accepts only plain, existing folders inside the allowed roots", () => {
    const nas = path.join(scratch, "nas");
    mkdirSync(path.join(nas, "wiki"), { recursive: true });
    expect(check(nas + "/wiki/")).toBe(nas + "/wiki"); // trailing slash dropped
    expect(check(nas)).toBe(nas);
    for (const bad of [
      "",
      "relative/dir",
      `${nas}/../nas/wiki`,
      `${nas}/./wiki`,
      `${nas}//wiki`,
      `${nas}/wi;ki`,
      `${nas}/wi$(id)ki`,
      `${nas}/wi\nki`,
      `${nas}/ wiki`,
      `${nas}/wiki\u0000`,
      "x".repeat(300),
      42,
      null,
      ["/mnt"],
    ])
      expect(() => check(bad), String(bad)).toThrow(/absolute path/);
    for (const bad of ["/", "/etc", "/etc/cron.d", "/proc/self", "/root", "/srvx", path.join(scratch, "other")])
      expect(() => check(bad), bad).toThrow(/isn’t allowed/);
    // never the wiki's own data (or anything containing it)
    expect(() => checkLocalDir(DATA_DIR, { roots: [path.dirname(DATA_DIR)], avoid: [DATA_DIR] })).toThrow(/own data/);
    expect(() => checkLocalDir(path.dirname(DATA_DIR), { roots: [path.dirname(DATA_DIR)], avoid: [DATA_DIR] })).toThrow(
      /own data/,
    );
    expect(() => check(path.join(nas, "missing"))).toThrow(/doesn’t exist/);
    writeFileSync(path.join(nas, "a-file"), "x");
    expect(() => check(path.join(nas, "a-file"))).toThrow(/doesn’t exist/);
    // a link that leads out of the allowed area is refused, not followed
    symlinkSync("/etc", path.join(nas, "sneaky"));
    expect(() => check(path.join(nas, "sneaky"))).toThrow(/link/);
  });

  it("the default list of roots is fixed; WIKI_BACKUP_ROOTS replaces it and can't open up /", () => {
    const old = process.env.WIKI_BACKUP_ROOTS;
    try {
      delete process.env.WIKI_BACKUP_ROOTS;
      expect(backupRoots()).toEqual(expect.arrayContaining(["/backups", "/mnt", "/media", "/srv"]));
      process.env.WIKI_BACKUP_ROOTS = " /, /mnt/nas/ , relative, /a/../etc ,/srv";
      expect(backupRoots()).toEqual(["/mnt/nas", "/srv"]);
      expect(checkBackupDir("")).toBe(""); // empty = the default folder
      expect(() => checkBackupDir("/etc")).toThrow(/isn’t allowed/);
    } finally {
      if (old === undefined) delete process.env.WIKI_BACKUP_ROOTS;
      else process.env.WIKI_BACKUP_ROOTS = old;
    }
  });

  it("a chosen folder that isn't there (share not mounted) fails loudly instead of being created", async () => {
    const gone = path.join(scratch, "nas", "unmounted");
    const st = new LocalStore(gone, { mustExist: true });
    await expect(testBackupTarget(st)).rejects.toThrow(/doesn’t exist/);
    await expect(st.list("v2/")).rejects.toThrow(/doesn’t exist/);
    expect(existsSync(gone)).toBe(false);
  });

  it("never follows a link planted in the backup folder (read, write, list, delete)", async () => {
    const root = path.join(scratch, "linked");
    const elsewhere = path.join(scratch, "elsewhere");
    mkdirSync(path.join(root, "v2", "objects"), { recursive: true });
    mkdirSync(elsewhere, { recursive: true });
    const st = new LocalStore(root);
    const id = "20260101-000000-abcdef";
    // a backup file that is really a link to a secret elsewhere
    writeFileSync(path.join(elsewhere, "secret"), "master key material");
    symlinkSync(path.join(elsewhere, "secret"), path.join(root, "v2", `${id}.data`));
    await expect(st.get(`v2/${id}.data`)).rejects.toThrow(/link/);
    await expect(st.exists(`v2/${id}.data`)).rejects.toThrow(/link/);
    expect((await st.list("v2/")).map((x) => x.key)).toEqual([]);
    // writing over it replaces the link, never the file it points to
    const src = path.join(scratch, "payload");
    writeFileSync(src, "new");
    await expect(st.put(`v2/${id}.data`, src)).rejects.toThrow(/link/);
    expect(readFileSync(path.join(elsewhere, "secret"), "utf8")).toBe("master key material");
    // a linked folder on the way
    rmSync(path.join(root, "v2"), { recursive: true });
    symlinkSync(elsewhere, path.join(root, "v2"));
    await expect(st.list("v2/")).rejects.toThrow(/link/);
    await expect(st.put(`v2/${id}.manifest`, src)).rejects.toThrow(/link/);
    await expect(st.delete(`v2/${id}.manifest`)).rejects.toThrow(/link/);
    expect(readdirSync(elsewhere)).toEqual(["secret"]);
  });

  it("switched off: no automatic backups (manual ones are refused by the API)", async () => {
    await updateSettings({ backup_enabled: false });
    try {
      expect(await backupIfDue()).toBeNull();
    } finally {
      await updateSettings({ backup_enabled: true });
    }
  });
});
