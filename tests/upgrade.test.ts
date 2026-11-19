import "./setup-env";
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { openLegacySqlite } from "@/lib/legacy-sqlite";
import { DATA_DIR } from "@/lib/config";
import { encrypt } from "@/lib/crypto";
import { hotp, base32Decode, generateSecret } from "@/lib/totp";
import { getSettings } from "@/lib/settings";
import { search } from "@/lib/search";
import * as auth from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { importSqliteIfPresent } from "@/lib/sqlite-import";
import { createPage, getPage, getTree, backlinks } from "@/lib/pages";
import { listTrash } from "@/lib/trash";
import { db } from "./pg";

describe("moving a Tidewiki 1.x wiki (SQLite) into PostgreSQL", () => {
  it("copies everything once — 2FA keeps working, older SQLite schemas are migrated first", async () => {
    const file = path.join(DATA_DIR, "wiki.db");
    const old = openLegacySqlite(file, 4); // a wiki from before devices, trash and versions
    const secret = generateSecret();
    const t = Math.floor(Date.now() / 1000);
    const pw = await hashPassword("tidal-marsh-lantern-47");
    const id = Number(
      old
        .prepare(
          "INSERT INTO users(username,email,password_hash,role,is_owner,created_at,password_changed_at,totp_enabled,totp_secret_enc,totp_last_step,recovery_hashes) VALUES('alt','alt@example.com',?,'admin',1,?,?,1,?,?,'[]')",
        )
        .run(pw, t, t, "", 0).lastInsertRowid,
    );
    old.prepare("UPDATE users SET totp_secret_enc=? WHERE id=?").run(encrypt(secret, `user:${id}:totp`), id);
    old.prepare("INSERT INTO settings(key,value) VALUES('require_2fa','true')").run();
    old.prepare("INSERT INTO settings(key,value) VALUES('site_name','\"Altes Wiki\"')").run();
    // the child gets the lower id: parents arrive later in id order and must be linked afterwards
    old
      .prepare(
        "INSERT INTO pages(id,slug,title,parent_id,position,content,rev,created_by,created_at,updated_at) VALUES(9,'eltern','Eltern',NULL,1,?,1,?,?,?)",
      )
      .run("Siehe [[Kind]] und\u0000 Rest", id, t, t);
    old
      .prepare(
        "INSERT INTO pages(id,slug,title,parent_id,position,content,rev,created_at,updated_at) VALUES(5,'kind','Kind',9,1,'Vorhandene Inhalte mit Bitte',1,?,?)",
      )
      .run(t, t);
    old
      .prepare(
        "INSERT INTO page_revisions(page_id,rev,title,content,created_at) VALUES(5,1,'Kind','Vorhandene Inhalte mit Bitte',?)",
      )
      .run(t);
    old.close();

    const r = await importSqliteIfPresent();
    expect(r).toMatchObject({ users: 1, pages: 2, page_revisions: 1 });
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(DATA_DIR).some((f) => /^wiki\.db\.imported-\d{4}-\d{2}-\d{2}$/.test(f))).toBe(true);
    expect(readdirSync(DATA_DIR).some((f) => f.includes(".import-"))).toBe(false); // the working copy is gone

    const s = await getSettings();
    expect([s.require_2fa_admin, s.require_2fa_editor, s.require_2fa_viewer]).toEqual([true, true, true]);
    expect(s.site_name).toBe("Altes Wiki");
    expect(await auth.listDevices(id)).toHaveLength(1);
    expect((await getPage("kind"))!.parent_id).toBe(9);
    expect((await getTree()).map((n) => n.slug)).toEqual(["eltern"]);
    expect((await getPage("eltern"))!.content).toBe("Siehe [[Kind]] und Rest"); // NUL can't live in PostgreSQL text
    expect((await backlinks("kind")).map((b) => b.slug)).toEqual(["eltern"]); // link index rebuilt
    expect(await listTrash()).toEqual([]);
    // the moved authenticator still signs in (same account id → same encryption context)
    const login = await auth.attemptLogin("alt", "tidal-marsh-lantern-47", null, null);
    expect(login.status).toBe("mfa");
    if (login.status !== "mfa") return;
    const code = hotp(base32Decode(secret), Math.floor(Date.now() / 30000));
    expect((await auth.completeMfa(login.token, code, null, null)).status).toBe("ok");
    // pages are searchable by substring right away
    expect((await search("itte")).hits.map((h) => h.slug)).toEqual(["kind"]);
    // ids continue after the imported ones
    const fresh = await createPage({ title: "Neu", content: "", parentId: null, userId: id });
    expect(fresh.id).toBeGreaterThan(9);
  });

  it("never imports into a database that already has accounts", async () => {
    const file = path.join(DATA_DIR, "wiki.db");
    const lite = openLegacySqlite(file);
    lite
      .prepare(
        "INSERT INTO users(username,email,password_hash,role,is_owner,created_at,password_changed_at) VALUES('x','x@example.com','x','admin',1,1,1)",
      )
      .run();
    lite.close();
    expect(await importSqliteIfPresent()).toBeNull();
    expect(existsSync(file)).toBe(true); // left alone
    expect(await db().prepare("SELECT 1 FROM users WHERE username='x'").get()).toBeUndefined();
  });
});
