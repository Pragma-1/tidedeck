import "./setup-env";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as auth from "@/lib/auth";
import { db } from "./pg";
import { now } from "@/lib/db";
import { createUser, eraseOwnAccount, exportUserData, listUsers, updateUser, deleteUser } from "@/lib/admin";
import { audit, exportAudit, queryAudit, toCsv } from "@/lib/audit";
import { LADDER, lockedFor, registerFailure, userKey, clearLock } from "@/lib/lockout";
import { translate, formatDuration } from "@/lib/i18n";
import { DE } from "@/lib/i18n-de";
import { createPage, getPage } from "@/lib/pages";
import { syncSystemPages, SYSTEM_PAGES } from "@/lib/seed";
import { renderMarkdown } from "@/lib/markdown";
import { updateSettings } from "@/lib/settings";
// @ts-expect-error plain ESM helper without types
import { scan } from "./i18n-scan.mjs";

const PW = "tidal-marsh-lantern-47";
const asUser = (id: number) => ({ id }) as unknown as import("@/lib/auth").SessionUser;
const reset = async () => {
  await db().prepare("DELETE FROM rate_limits").run();
  await db().prepare("DELETE FROM lockouts").run();
};

describe("i18n", () => {
  const SKIP = new Set([", e instanceof Error ? e.message : ", "null"]);
  it("every user-facing string in the source has a German translation", async () => {
    const missing: string[] = [];
    for (const s of scan() as { text: string; sample: string; file: string }[]) {
      if (SKIP.has(s.text)) continue;
      if (s.text.includes("${")) {
        if (translate("de", s.sample) === s.sample) missing.push(`${s.file}: ${s.text}`);
      } else if (DE[s.text] === undefined) missing.push(`${s.file}: ${s.text}`);
    }
    expect(missing).toEqual([]);
  });
  it("keeps placeholders and translates pre-formatted server messages", async () => {
    expect(translate("de", "At least {n} characters.", { n: 14 })).toBe("Mindestens 14 Zeichen.");
    expect(translate("de", "Use at least 12 characters. A passphrase of several words works well.")).toMatch(
      /mindestens 12 Zeichen/,
    );
    expect(translate("de", "Username is required.")).toBe("Benutzername ist erforderlich.");
    expect(translate("de", "Title is too long (max 120).")).toBe("Titel ist zu lang (höchstens 120).");
    expect(translate("en", "At least {n} characters.", { n: 14 })).toBe("At least 14 characters.");
    expect(translate("de", "some text nobody translated")).toBe("some text nobody translated");
  });
  it("German placeholders match the English ones", async () => {
    const names = (s: string) =>
      [...s.matchAll(/\{(\w+)\}/g)]
        .map((m) => m[1])
        .sort()
        .join(",");
    const bad = Object.entries(DE)
      .filter(([k, v]) => names(k) !== names(v))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });
  it("formats lock durations", async () => {
    expect(LADDER.map((s) => formatDuration(s, "de"))).toEqual([
      "10 min",
      "20 min",
      "1 Std.",
      "3 Std.",
      "6 Std.",
      "12 Std.",
      "24 Std.",
    ]);
    expect(formatDuration(3700, "en")).toBe("1 h 2 min");
  });
});

let owner = 0;
describe("setup + built-in pages in German", () => {
  it("the setup account is the owner and pages are seeded in the site language (German by default)", async () => {
    owner = await auth.setupAdmin((await auth.ensureSetupToken())!, "chef", "chef@example.com", PW, null);
    expect((await auth.userById(owner))!.is_owner).toBe(1);
    expect((await getPage("welcome"))!.title).toBe("Willkommen");
    expect((await getPage("markdown-guide"))!.title).toBe("Markdown-Anleitung");
  });
  it("switches unedited built-in pages with the site language, never edited ones", async () => {
    await updateSettings({ language: "en" });
    expect(await syncSystemPages("en")).toBe(2);
    expect((await getPage("welcome"))!.title).toBe("Welcome");
    expect((await getPage("welcome"))!.content).toBe(SYSTEM_PAGES.welcome.versions.en.content);
    await db().prepare("UPDATE pages SET content=content||'\nlocal note' WHERE slug='markdown-guide'").run();
    await updateSettings({ language: "de" });
    expect(await syncSystemPages("de")).toBe(1);
    expect((await getPage("welcome"))!.title).toBe("Willkommen");
    expect((await getPage("markdown-guide"))!.title).toBe("Markdown guide"); // edited -> left alone
    expect(await syncSystemPages("de")).toBe(0); // idempotent
  });
  it("an untouched guide from an earlier release is upgraded to the current one (with the new sections)", async () => {
    const legacyDe = SYSTEM_PAGES["markdown-guide"].legacy!.filter((v) => v.title === "Markdown-Anleitung");
    expect(legacyDe.length).toBe(2); // v1 and v2
    for (const old of legacyDe) {
      await db().prepare("UPDATE pages SET title=?, content=? WHERE slug='markdown-guide'").run(old.title, old.content);
      expect(await syncSystemPages("de")).toBe(1);
      const g = (await getPage("markdown-guide"))!;
      expect(g.content).toBe(SYSTEM_PAGES["markdown-guide"].versions.de.content);
    }
    const cur = SYSTEM_PAGES["markdown-guide"].versions.de.content;
    for (const section of [
      "## Links",
      "Bild-in-Bild",
      "neuen Tab",
      "## Codeblöcke kopieren",
      "## Markdown-Dateien importieren",
      "## Suchen",
      "`t*st`",
    ])
      expect(cur).toContain(section);
    // every snippet in the guide renders without leftovers of raw syntax
    const html = renderMarkdown(cur, { lang: "de" }).html;
    expect(html).toContain("<table");
    expect(html).not.toContain("::: ");
  });
});

describe("escalating lock-out", () => {
  const key = "fail:test:ladder";
  const expire = async () =>
    await db()
      .prepare("UPDATE lockouts SET locked_until=? WHERE key=?")
      .run(now() - 1, key);
  it("follows 10 min → 20 min → 1 h → 3 h → 6 h → 12 h → 24 h and stays at 24 h", async () => {
    const seen: number[] = [];
    for (let round = 0; round < 9; round++) {
      let d: number | null = null;
      for (let i = 0; i < 5; i++) {
        expect(await lockedFor(key)).toBe(0);
        d = await registerFailure(key, 5, null);
      }
      seen.push(d!);
      expect(await lockedFor(key)).toBeGreaterThan(d! - 3);
      await expire();
    }
    expect(seen).toEqual([600, 1200, 3600, 10800, 21600, 43200, 86400, 86400, 86400]);
  });
  it("starts over after a day without a new lock-out, and a clear resets everything", async () => {
    await db()
      .prepare("UPDATE lockouts SET locked_until=? WHERE key=?")
      .run(now() - 86401, key);
    let d: number | null = null;
    for (let i = 0; i < 5; i++) d = await registerFailure(key, 5, null);
    expect(d).toBe(600);
    await clearLock(key);
    expect(await lockedFor(key)).toBe(0);
  });
  it("failures older than 15 minutes don't count towards the limit", async () => {
    const k = "fail:test:window";
    for (let i = 0; i < 4; i++) await registerFailure(k, 5, null);
    await db()
      .prepare("UPDATE lockouts SET window_start=? WHERE key=?")
      .run(now() - 901, k);
    expect(await registerFailure(k, 5, null)).toBeNull();
  });
  it("sign-in reports the remaining time and the admin unlock works instantly", async () => {
    await reset();
    const id = await createUser(
      owner,
      { username: "lockme", email: "lockme@example.com", role: "editor", password: PW },
      null,
    );
    for (let i = 0; i < 5; i++)
      expect((await auth.attemptLogin("lockme", "wrong-wrong-wrong-1", null, null)).status).toBe("fail");
    const r = await auth.attemptLogin("lockme", PW, null, null);
    expect(r.status).toBe("blocked");
    if (r.status === "blocked") expect(r.retryIn).toBeGreaterThan(590);
    expect((await listUsers()).find((u) => u.id === id)!.locked_until).toBeGreaterThan(now());
    expect((await queryAudit({ q: "login.locked" })).rows[0].target_id).toBe(id);
    await updateUser(owner, id, { action: "unlock" }, null);
    expect(await lockedFor(userKey(id))).toBe(0);
    expect((await auth.attemptLogin("lockme", PW, null, null)).status).toBe("ok");
  });
});

describe("user management (owner = super admin)", () => {
  let admin2 = 0,
    ed = 0;
  it("only the owner creates administrators; admins create editors", async () => {
    admin2 = await createUser(
      owner,
      { username: "admin2", email: "admin2@example.com", role: "admin", password: PW },
      null,
    );
    await expect(
      createUser(admin2, { username: "admin3", email: "a3@example.com", role: "admin", password: PW }, null),
    ).rejects.toThrow(/Only the owner/);
    ed = await createUser(admin2, { username: "edda", email: "edda@example.com", role: "editor", password: PW }, null);
    await expect(
      createUser(admin2, { username: "weak", email: "w@example.com", role: "viewer", password: "short" }, null),
    ).rejects.toThrow(/at least/);
    await expect(
      createUser(admin2, { username: "edda", email: "x@example.com", role: "viewer", password: PW }, null),
    ).rejects.toThrow(/already in use/);
  });
  it("admins can't touch the owner or other admins, and can't promote to admin", async () => {
    await expect(updateUser(admin2, owner, { username: "hacked" }, null)).rejects.toThrow(/owner/);
    await expect(updateUser(admin2, owner, { password: "another-long-passphrase-1" }, null)).rejects.toThrow(/owner/);
    await expect(deleteUser(admin2, owner, null)).rejects.toThrow(/owner/);
    await expect(updateUser(admin2, ed, { role: "admin" }, null)).rejects.toThrow(/Only the owner/);
    await expect(updateUser(owner, owner, { role: "editor" }, null)).rejects.toThrow(/own role/);
    await expect(updateUser(owner, owner, { disabled: true }, null)).rejects.toThrow(/own account/);
  });
  it("edits name, e-mail and password; a new password signs the person out", async () => {
    await reset();
    const s = await auth.attemptLogin("edda", PW, null, null);
    expect(s.status).toBe("ok");
    await updateUser(
      admin2,
      ed,
      { username: "eddie", email: "eddie@example.com", password: "fresh-river-passphrase-8" },
      null,
    );
    if (s.status === "ok") expect(await auth.resolveSession(s.token)).toBeNull();
    expect((await auth.userById(ed))!.username).toBe("eddie");
    expect((await auth.attemptLogin("eddie@example.com", "fresh-river-passphrase-8", null, null)).status).toBe("ok");
    await expect(updateUser(admin2, ed, { email: "not-an-email" }, null)).rejects.toThrow(/e-mail/);
    await expect(updateUser(admin2, ed, { username: "chef" }, null)).rejects.toThrow(/already in use/);
  });
  it("ownership can be handed to an active admin only, by the owner only", async () => {
    await expect(updateUser(admin2, admin2, { action: "transfer_ownership" }, null)).rejects.toThrow(/Only the owner/);
    await expect(updateUser(owner, ed, { action: "transfer_ownership" }, null)).rejects.toThrow(/active administrator/);
    await updateUser(owner, admin2, { action: "transfer_ownership" }, null);
    expect((await auth.userById(admin2))!.is_owner).toBe(1);
    expect((await auth.userById(owner))!.is_owner).toBe(0);
    await updateUser(admin2, owner, { action: "transfer_ownership" }, null); // and back
    expect((await auth.userById(owner))!.is_owner).toBe(1);
  });
});

describe("security log", () => {
  it("searches by event id, label (both languages), user, category and date", async () => {
    const id = Number(
      (await db()
        .prepare("INSERT INTO audit_log(ts,user_id,event,ip,detail) VALUES(?,?,?,?,?) RETURNING id")
        .get(1_700_000_000, owner, "login.ok", "203.0.113.7", "probe"))!.id,
    );
    expect((await queryAudit({ q: `#${id}` })).rows.map((r) => r.id)).toContain(id);
    expect((await queryAudit({ q: "Angemeldet" })).rows.some((r) => r.event === "login.ok")).toBe(true);
    expect((await queryAudit({ q: "Signed in" })).rows.some((r) => r.event === "login.ok")).toBe(true);
    expect((await queryAudit({ q: "203.0.113" })).rows[0].id).toBe(id);
    expect(
      (await queryAudit({ category: "signin", userId: owner })).rows.every((r) => r.event.startsWith("login.")),
    ).toBe(true);
    expect((await queryAudit({ from: 1_699_999_000, to: 1_700_001_000 })).rows.map((r) => r.id)).toEqual([id]);
    expect((await queryAudit({ q: "%" })).rows.length).toBe(0); // LIKE wildcards are escaped
    const page1 = await queryAudit({ limit: 3 });
    const page2 = await queryAudit({ limit: 3, before: page1.rows[2].id });
    expect(page2.rows[0].id).toBeLessThan(page1.rows[2].id);
    expect(page1.total).toBe(page2.total);
  });
  it("CSV export neutralises spreadsheet formulas", async () => {
    const csv = toCsv([{ a: '=HYPERLINK("http://evil")', b: "+1", c: "plain, with comma" }], ["a", "b", "c"]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain("'+1");
    expect(csv).toContain(`"plain, with comma"`);
  });
});

describe("GDPR", () => {
  it("exports a person's data without secrets", async () => {
    const id = await createUser(
      owner,
      { username: "gina", email: "gina@example.com", role: "editor", password: PW },
      null,
    );
    await auth.attemptLogin("gina", PW, "198.51.100.4", "probe-agent");
    const data = await exportUserData(id);
    const s = JSON.stringify(data);
    expect(data.account.email).toBe("gina@example.com");
    expect(data.security_log.some((e) => e.event === "admin.user_created")).toBe(true);
    expect(s).not.toMatch(/argon2|password_hash|totp_secret|recovery_hashes/);
  });
  it("erasure deletes everything personal but keeps the pages, and leaves no trace on disk", async () => {
    await reset();
    const id = await createUser(
      owner,
      { username: "erika", email: "erika.mustermann@example.com", role: "editor", password: PW },
      null,
    );
    const s = await auth.attemptLogin("erika", PW, "192.0.2.55", "erika-browser");
    for (let i = 0; i < 3; i++) await auth.attemptLogin("erika", "wrong-wrong-wrong-1", "192.0.2.55", null);
    const page = await createPage({ title: "Erikas Seite", content: "shared knowledge", parentId: null, userId: id });
    await audit("page.created", id, "192.0.2.55", page.slug);
    await expect(eraseOwnAccount(asUser(id), "wrong-wrong-wrong-1")).rejects.toThrow(/not correct/);
    await eraseOwnAccount(asUser(id), PW);

    expect(await auth.userById(id)).toBeUndefined();
    if (s.status === "ok") expect(await auth.resolveSession(s.token)).toBeNull();
    expect(await exportAudit({ userId: id })).toEqual([]);
    expect(
      await db().prepare("SELECT COUNT(*) n FROM audit_log WHERE ip='192.0.2.55' OR detail LIKE '%erika%'").get(),
    ).toEqual({ n: 0 });
    expect(await db().prepare("SELECT COUNT(*) n FROM lockouts WHERE key LIKE '%erika%' OR user_id=?").get(id)).toEqual(
      {
        n: 0,
      },
    );
    const kept = (await getPage(page.slug))!;
    expect(kept.content).toBe("shared knowledge");
    expect(kept.created_by).toBeNull();
    const erased = (await queryAudit({ q: "account.erased" })).rows[0];
    expect(erased.detail).toBe(`#${id}`);
    expect(erased.ip).toBeNull();
    // secure_delete + WAL checkpoint: the address must not survive anywhere in the database files
    const dir = process.env.WIKI_DATA_DIR!;
    for (const f of ["wiki.db", "wiki.db-wal"].map((x) => path.join(dir, x)).filter(existsSync)) {
      expect(readFileSync(f).includes(Buffer.from("erika.mustermann@example.com"))).toBe(false);
    }
  });
  it("the owner and the last admin can't erase themselves", async () => {
    await expect(eraseOwnAccount(asUser(owner), PW)).rejects.toThrow(/own this wiki/);
  });
});

describe("text selection is visible everywhere", () => {
  it("the selection colour is its own, never the background of a block (warnings, marks, notes)", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    const sel = /::selection\s*\{[^}]*background:\s*var\((--[\w-]+)\)/.exec(css)?.[1];
    expect(sel).toBeDefined();
    // every variable used as a background somewhere else
    const used = new Set(
      [...css.replace(/::selection\s*\{[^}]*\}/g, "").matchAll(/background(?:-color)?:\s*var\((--[\w-]+)\)/g)].map(
        (m) => m[1],
      ),
    );
    expect(used.has("--hl")).toBe(true); // the warning callout's background, the original bug
    expect(used.has(sel!)).toBe(false);
  });
});
