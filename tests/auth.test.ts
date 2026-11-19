import "./setup-env";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mail", () => {
  const sent: { to: string; subject: string; text: string }[] = [];
  return {
    isMailConfigured: () => true,
    sendMail: async (to: string, subject: string, text: string) => {
      sent.push({ to, subject, text });
    },
    __sent: sent,
  };
});

import * as auth from "@/lib/auth";
import { db } from "./pg";
import { updateSettings, getSettings } from "@/lib/settings";
import { hotp, base32Decode } from "@/lib/totp";
import { sha256 } from "@/lib/crypto";
import * as mail from "@/lib/mail";
import { createPage, updatePage, getPage, getTree } from "@/lib/pages";
import { trashPage } from "@/lib/trash";
import { search } from "@/lib/search";

const sent = (mail as unknown as { __sent: { to: string; text: string }[] }).__sent;
const PW = "tidal-marsh-lantern-47";
const resetLimits = async () => {
  await db().prepare("DELETE FROM rate_limits").run();
  await db().prepare("DELETE FROM lockouts").run();
};
let adminId = 0;

describe("first-run setup", () => {
  it("requires the setup token and only works once", async () => {
    const token = (await auth.ensureSetupToken())!;
    expect(token.length).toBeGreaterThan(16);
    await expect(auth.setupAdmin("wrong", "admin", "a@example.com", PW, null)).rejects.toThrow(/token/);
    for (let i = 0; i < 9; i++)
      await expect(auth.setupAdmin("wrong", "admin", "a@example.com", PW, null)).rejects.toThrow(/not correct/);
    // 10 wrong tokens with no known client IP -> blocked globally, even the right token
    await expect(auth.setupAdmin(token, "admin", "a@example.com", PW, null)).rejects.toThrow(
      /Too many wrong setup tokens/,
    );
    await resetLimits();
    adminId = await auth.setupAdmin(token, "admin", "a@example.com", PW, null);
    expect((await auth.userById(adminId))!.role).toBe("admin");
    await expect(auth.setupAdmin(token, "evil", "e@example.com", PW, null)).rejects.toThrow(/already complete/);
    expect(await auth.ensureSetupToken()).toBeNull();
    expect(await db().prepare("SELECT COUNT(*) n FROM pages").get()).toEqual({ n: 2 });
  });
  it("stores only an argon2id hash (never the password)", async () => {
    const u = (await auth.userById(adminId))!;
    expect(u.password_hash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(u)).not.toContain(PW);
  });
});

describe("login, sessions, lockout", () => {
  it("logs in with username or email, stores only the token hash", async () => {
    const r = await auth.attemptLogin("ADMIN", PW, null, "ua");
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(await db().prepare("SELECT 1 FROM sessions WHERE id_hash=?").get(r.token)).toBeUndefined();
    expect(await db().prepare("SELECT 1 FROM sessions WHERE id_hash=?").get(sha256(r.token))).toBeTruthy();
    expect((await auth.resolveSession(r.token))?.username).toBe("admin");
    expect((await auth.attemptLogin("a@example.com", PW, null, null)).status).toBe("ok");
    await auth.destroySession(r.token);
    expect(await auth.resolveSession(r.token)).toBeNull();
  });
  it("rejects garbage tokens and expired sessions", async () => {
    expect(await auth.resolveSession("x")).toBeNull();
    expect(await auth.resolveSession("A".repeat(43))).toBeNull();
    const t = await auth.createSession(adminId, "full", -10, null, null);
    expect(await auth.resolveSession(t)).toBeNull();
  });
  it("an MFA-stage token is not a session", async () => {
    const t = await auth.createSession(adminId, "mfa", 300, null, null);
    expect(await auth.resolveSession(t)).toBeNull();
  });
  it("locks after N failures, identically for unknown users", async () => {
    const max = (await getSettings()).max_login_attempts;
    for (let i = 0; i < max; i++) {
      expect((await auth.attemptLogin("ghost", "nope-nope-nope-1", null, null)).status).toBe("fail");
      expect((await auth.attemptLogin("admin", "nope-nope-nope-1", null, null)).status).toBe("fail");
    }
    expect((await auth.attemptLogin("ghost", "nope-nope-nope-1", null, null)).status).toBe("blocked");
    expect((await auth.attemptLogin("admin", PW, null, null)).status).toBe("blocked"); // correct password still blocked
    await resetLimits();
    expect((await auth.attemptLogin("admin", PW, null, null)).status).toBe("ok");
  });
});

describe("registration toggle", () => {
  it("is off by default and obeys the setting + role", async () => {
    await expect(auth.registerUser("bob", "bob@example.com", PW, null)).rejects.toThrow(/turned off/);
    await updateSettings({ allow_registration: true, registration_role: "viewer" });
    const id = await auth.registerUser("bob", "bob@example.com", PW, null);
    expect((await auth.userById(id))!.role).toBe("viewer");
    await expect(auth.registerUser("bob", "other@example.com", PW, null)).rejects.toThrow(/already in use/);
    await expect(auth.registerUser("BOB", "x@example.com", PW, null)).rejects.toThrow(/already in use/);
    await expect(auth.registerUser("x y", "x@example.com", PW, null)).rejects.toThrow(/Username/);
    await expect(auth.registerUser("carol", "not-an-email", PW, null)).rejects.toThrow(/e-mail/);
    await expect(auth.registerUser("carol", "c@example.com", "short", null)).rejects.toThrow(/at least/);
    await updateSettings({ allow_registration: false });
    await expect(auth.registerUser("dave", "d@example.com", PW, null)).rejects.toThrow(/turned off/);
  });
  it("settings reject unknown keys and bad values", async () => {
    expect(await updateSettings({ role: "admin" })).toMatchObject({ ok: false });
    expect(await updateSettings({ session_hours: 99999 })).toMatchObject({ ok: false });
    expect(await updateSettings({ allow_registration: "true" })).toMatchObject({ ok: false });
    expect(await updateSettings({ registration_role: "admin" })).toMatchObject({ ok: false });
    expect(await updateSettings({ __proto__: 1, constructor: 1 } as never)).toMatchObject({ ok: false });
    expect(await updateSettings({ site_name: "<img onerror=1>" })).toMatchObject({ ok: false });
  });
});

describe("2FA", () => {
  const code = (secret: string, d = 0) => hotp(base32Decode(secret), Math.floor(Date.now() / 30000) + d);
  let secret = "";
  let recovery: string[] = [];
  it("setup needs the password, secret is encrypted at rest", async () => {
    const su = (await auth.resolveSession(
      ((await auth.attemptLogin("admin", PW, null, null)) as { token: string }).token,
    ))!;
    await expect(auth.beginTotpSetup(su, "wrong-password-123")).rejects.toThrow(/not correct/);
    const s = await auth.beginTotpSetup(su, PW);
    secret = s.secret;
    expect(s.uri).toMatch(/^otpauth:\/\/totp\//);
    expect((await auth.userById(adminId))!.totp_pending_enc).not.toContain(secret);
    await expect(auth.enableTotp(su, "000000", null)).rejects.toThrow(/didn’t match/);
    recovery = (await auth.enableTotp(su, code(secret), null, "Phone"))!;
    expect(recovery).toHaveLength(10);
    const row = (await auth.userById(adminId))!;
    expect(row.totp_enabled).toBe(1);
    expect(row.totp_pending_enc).toBeNull();
    const devs = (await db().prepare("SELECT * FROM totp_devices WHERE user_id=?").all(adminId)) as {
      name: string;
      secret_enc: string;
    }[];
    expect(devs).toHaveLength(1);
    expect(devs[0].name).toBe("Phone");
    expect(devs[0].secret_enc).not.toContain(secret);
    expect(row.recovery_hashes).not.toContain(recovery[0]);
  });
  it("password alone no longer yields a session", async () => {
    await resetLimits();
    await db().prepare("UPDATE totp_devices SET last_step=0 WHERE user_id=?").run(adminId);
    const r = await auth.attemptLogin("admin", PW, null, null);
    expect(r.status).toBe("mfa");
    if (r.status !== "mfa") return;
    expect(await auth.resolveSession(r.token)).toBeNull();
    expect((await auth.completeMfa(r.token, "123456", null, null)).status).toBe("fail");
    const ok = await auth.completeMfa(r.token, code(secret), null, null);
    expect(ok.status).toBe("ok");
    expect((await auth.completeMfa(r.token, code(secret), null, null)).status).toBe("expired"); // mfa token consumed
  });
  it("a TOTP code cannot be replayed", async () => {
    await resetLimits();
    const r = await auth.attemptLogin("admin", PW, null, null);
    if (r.status !== "mfa") throw new Error("expected mfa");
    expect((await auth.completeMfa(r.token, code(secret), null, null)).status).toBe("fail");
  });
  it("mfa attempts are capped per challenge", async () => {
    await resetLimits();
    const r = await auth.attemptLogin("admin", PW, null, null);
    if (r.status !== "mfa") throw new Error("expected mfa");
    for (let i = 0; i < 4; i++) await auth.completeMfa(r.token, "000000", null, null);
    expect((await auth.completeMfa(r.token, "000000", null, null)).status).toBe("fail");
    expect((await auth.completeMfa(r.token, code(secret, 1), null, null)).status).toBe("blocked");
  });
  it("recovery codes work exactly once", async () => {
    await resetLimits();
    let r = await auth.attemptLogin("admin", PW, null, null);
    if (r.status !== "mfa") throw new Error("expected mfa");
    expect((await auth.completeMfa(r.token, recovery[0].toUpperCase().replace("-", " "), null, null)).status).toBe(
      "ok",
    );
    r = await auth.attemptLogin("admin", PW, null, null);
    if (r.status !== "mfa") throw new Error("expected mfa");
    expect((await auth.completeMfa(r.token, recovery[0], null, null)).status).toBe("fail");
    expect(await auth.recoveryCodesLeft(adminId)).toBe(9);
  });
  it("can be disabled only with password, and not when enforced", async () => {
    await resetLimits();
    const su = {
      ...(await auth.resolveSession(((await auth.attemptLogin("bob", PW, null, null)) as { token: string }).token))!,
    };
    expect(su.username).toBe("bob");
    const own = `require_2fa_${su.role}`,
      other = su.role === "viewer" ? "require_2fa_editor" : "require_2fa_viewer";
    await updateSettings({ [own]: true });
    await expect(auth.disableTotp(su, PW, null)).rejects.toThrow(/required for your role/);
    expect(
      (await auth.resolveSession(((await auth.attemptLogin("bob", PW, null, null)) as { token: string }).token))!
        .needs2faSetup,
    ).toBe(true);
    // per role: requiring it for viewers or admins doesn't affect an editor
    await updateSettings({ [own]: false, [other]: true, require_2fa_admin: true });
    expect(
      (await auth.resolveSession(((await auth.attemptLogin("bob", PW, null, null)) as { token: string }).token))!
        .needs2faSetup,
    ).toBe(false);
    await updateSettings({ [other]: false, require_2fa_admin: false });
  });
  it("several devices: each works, each has its own replay protection, removal rules", async () => {
    await resetLimits();
    const su = (await auth.resolveSession(
      ((await auth.attemptLogin("bob", PW, null, null)) as { token: string }).token,
    ))!;
    const s1 = await auth.beginTotpSetup(su, PW);
    const codes = await auth.enableTotp(su, code(s1.secret), null, "Phone");
    expect(codes).toHaveLength(10);
    const su2 = (await auth.resolveSession(await completeLogin("bob", s1.secret, 1)))!;
    const s2 = await auth.beginTotpSetup(su2, PW);
    expect(await auth.enableTotp(su2, code(s2.secret), null, "Tablet")).toBeNull(); // second device keeps the recovery codes
    expect(await auth.recoveryCodesLeft(su.id)).toBe(10);
    const devs = await auth.listDevices(su.id);
    expect(devs.map((d) => d.name)).toEqual(["Phone", "Tablet"]);
    expect(JSON.stringify(devs)).not.toMatch(/secret/);
    // both devices sign in; a step used on one device can't be replayed on the same device
    await db().prepare("UPDATE totp_devices SET last_step=0 WHERE user_id=?").run(su.id);
    expect(await completeLogin("bob", s2.secret, 0)).toBeTruthy();
    await resetLimits();
    const again = (await auth.attemptLogin("bob", PW, null, null)) as { token: string };
    expect((await auth.completeMfa(again.token, code(s2.secret), null, null)).status).toBe("fail");
    // names are validated
    await expect(auth.renameDevice(su2, devs[0].id, "<b>x</b>", null)).rejects.toThrow(/40 characters/);
    await auth.renameDevice(su2, devs[0].id, "Old phone", null);
    // someone else's device can't be touched
    const admin = (await auth.resolveSession(await auth.createSession(adminId, "full", 600, null, null)))!;
    await expect(auth.removeDevice(admin, devs[0].id, PW, null)).rejects.toThrow(/no longer exists/);
    await expect(auth.renameDevice(admin, devs[0].id, "mine", null)).rejects.toThrow(/no longer exists/);
    // removal needs the password; the last device can't go while the role requires 2FA
    await expect(auth.removeDevice(su2, devs[0].id, "wrong-password-123", null)).rejects.toThrow(/not correct/);
    await auth.removeDevice(su2, devs[0].id, PW, null);
    await updateSettings({ [`require_2fa_${su.role}`]: true });
    await expect(auth.removeDevice(su2, devs[1].id, PW, null)).rejects.toThrow(/Add another device/);
    await updateSettings({ [`require_2fa_${su.role}`]: false });
    await auth.removeDevice(su2, devs[1].id, PW, null);
    const row = (await auth.userById(su.id))!;
    expect(row.totp_enabled).toBe(0);
    expect(row.recovery_hashes).toBe("[]");
    expect((await auth.attemptLogin("bob", PW, null, null)).status).toBe("ok");
  });
  it("at most 10 devices, and a pending secret can't be swapped mid-setup", async () => {
    await resetLimits();
    const su = (await auth.resolveSession(await auth.createSession(adminId, "full", 600, null, null)))!;
    const a = await auth.beginTotpSetup(su, PW);
    const b = await auth.beginTotpSetup(su, PW); // second setup replaces the first pending secret
    await expect(auth.enableTotp(su, code(a.secret), null, "A")).rejects.toThrow(/didn’t match/);
    expect(await auth.enableTotp(su, code(b.secret), null, "B")).toBeNull();
    const now = Math.floor(Date.now() / 1000);
    for (let i = (await auth.listDevices(adminId)).length; i < 10; i++)
      await db()
        .prepare("INSERT INTO totp_devices(user_id,name,secret_enc,created_at) VALUES(?,?,?,?)")
        .run(adminId, `d${i}`, "x", now);
    await expect(auth.beginTotpSetup(su, PW)).rejects.toThrow(/at most 10/);
    await db().prepare("DELETE FROM totp_devices WHERE user_id=? AND secret_enc='x'").run(adminId);
  });
});

/** Password + TOTP sign-in; returns the full session token. */
async function completeLogin(user: string, secret: string, offset: number) {
  await resetLimits();
  const r = await auth.attemptLogin(user, PW, null, null);
  if (r.status !== "mfa") throw new Error(`expected mfa, got ${r.status}`);
  const c = hotp(base32Decode(secret), Math.floor(Date.now() / 30000) + offset);
  const ok = await auth.completeMfa(r.token, c, null, null);
  if (ok.status !== "ok") throw new Error(`mfa ${ok.status}`);
  return ok.token;
}

describe("own sessions and profile", () => {
  it("lists sessions by derived handle; signs out one or all others; never someone else's", async () => {
    await resetLimits();
    const t1 = ((await auth.attemptLogin("bob", PW, null, "UA-1")) as { token: string }).token;
    const t2 = ((await auth.attemptLogin("bob", PW, null, "UA-2")) as { token: string }).token;
    const t3 = ((await auth.attemptLogin("bob", PW, null, "UA-3")) as { token: string }).token;
    const me = (await auth.resolveSession(t1))!;
    const list = await auth.listSessions(me.id);
    const handles = list.map((s) => auth.sessionHandle(s.id_hash));
    expect(handles.every((h) => /^[0-9a-f]{24}$/.test(h))).toBe(true);
    expect(handles).not.toContain(sha256(t1));
    const h2 = auth.sessionHandle(sha256(t2));
    expect(await auth.revokeOwnSession(me, h2, null)).toEqual({ current: false });
    expect(await auth.resolveSession(t2)).toBeNull();
    await expect(auth.revokeOwnSession(me, h2, null)).rejects.toThrow(/no longer exists/);
    await expect(auth.revokeOwnSession(me, "' OR 1=1 --", null)).rejects.toThrow(/no longer exists/);
    // the admin's session handle is not reachable from bob's account
    const adminTok = await auth.createSession(adminId, "full", 600, null, null);
    await expect(auth.revokeOwnSession(me, auth.sessionHandle(sha256(adminTok)), null)).rejects.toThrow(
      /no longer exists/,
    );
    expect(await auth.resolveSession(adminTok)).not.toBeNull();
    expect(await auth.revokeOtherSessions(me, null)).toBeGreaterThanOrEqual(1);
    expect(await auth.resolveSession(t3)).toBeNull();
    expect(await auth.resolveSession(t1)).not.toBeNull();
    expect(await auth.revokeOwnSession(me, auth.sessionHandle(sha256(t1)), null)).toEqual({ current: true });
  });
  it("changes username and e-mail only with the password; keeps them unique; tells the old address", async () => {
    await resetLimits();
    sent.length = 0;
    const me = (await auth.resolveSession(
      ((await auth.attemptLogin("bob", PW, null, null)) as { token: string }).token,
    ))!;
    await expect(
      auth.updateProfile(me, { username: "bobby", email: me.email, password: "wrong-password-1" }, null),
    ).rejects.toThrow(/not correct/);
    await expect(auth.updateProfile(me, { username: "admin", email: me.email, password: PW }, null)).rejects.toThrow(
      /already in use/,
    );
    await expect(
      auth.updateProfile(me, { username: "bob", email: "A@EXAMPLE.COM", password: PW }, null),
    ).rejects.toThrow(/already in use/);
    await expect(auth.updateProfile(me, { username: "<script>", email: me.email, password: PW }, null)).rejects.toThrow(
      /Username/,
    );
    expect(await auth.updateProfile(me, { username: "bob", email: me.email, password: "" }, null)).toEqual({
      changed: false,
    });
    const old = me.email;
    expect(await auth.updateProfile(me, { username: "bobby", email: "bobby@example.com", password: PW }, null)).toEqual(
      { changed: true },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(sent.map((m) => m.to)).toEqual([old]);
    expect(sent[0].text).not.toContain("bobby@example.com"); // the new address is masked in the notice
    expect((await auth.attemptLogin("bobby", PW, null, null)).status).toBe("ok");
    await auth.updateProfile(
      (await auth.resolveSession(((await auth.attemptLogin("bobby", PW, null, null)) as { token: string }).token))!,
      { username: "bob", email: old, password: PW },
      null,
    );
  });
});

describe("password reset by e-mail", () => {
  const tokenFrom = (text: string) => /#token=([\w-]+)/.exec(text)![1];
  it("answers silently for unknown addresses and sends nothing", async () => {
    sent.length = 0;
    await auth.requestPasswordReset("nobody@example.com", null);
    expect(sent).toHaveLength(0);
  });
  it("sends a fragment link, stores only the hash, token is single-use and kills sessions", async () => {
    await resetLimits();
    const r = (await auth.attemptLogin("bob", PW, null, null)) as { token: string };
    await auth.requestPasswordReset("BOB@example.com", null);
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/\/reset#token=/);
    expect(sent[0].text).not.toMatch(/\?token=/);
    const token = tokenFrom(sent[0].text);
    expect(await db().prepare("SELECT 1 FROM reset_tokens WHERE token_hash=?").get(token)).toBeUndefined();
    await expect(auth.performPasswordReset(token, "short", null)).rejects.toThrow(/at least/);
    await auth.performPasswordReset(token, "brand-new-harbor-passphrase-9", null);
    await expect(auth.performPasswordReset(token, "another-harbor-passphrase-10", null)).rejects.toThrow(
      /invalid or has expired/,
    );
    expect(await auth.resolveSession(r.token)).toBeNull();
    expect((await auth.attemptLogin("bob", PW, null, null)).status).toBe("fail");
    expect((await auth.attemptLogin("bob", "brand-new-harbor-passphrase-9", null, null)).status).toBe("ok");
  });
  it("a newer link invalidates older ones; expired and forged tokens fail", async () => {
    await resetLimits();
    sent.length = 0;
    await auth.requestPasswordReset("bob@example.com", null);
    await auth.requestPasswordReset("bob@example.com", null);
    await new Promise((r) => setTimeout(r, 20));
    await expect(auth.performPasswordReset(tokenFrom(sent[0].text), "yet-another-passphrase-11", null)).rejects.toThrow(
      /invalid/,
    );
    await db().prepare("UPDATE reset_tokens SET expires_at=1").run();
    await expect(auth.performPasswordReset(tokenFrom(sent[1].text), "yet-another-passphrase-11", null)).rejects.toThrow(
      /invalid/,
    );
    await expect(auth.performPasswordReset("A".repeat(43), "yet-another-passphrase-11", null)).rejects.toThrow(
      /invalid/,
    );
    await expect(auth.performPasswordReset("' OR 1=1 --", "yet-another-passphrase-11", null)).rejects.toThrow(
      /invalid/,
    );
  });
  it("respects the admin switch", async () => {
    await resetLimits();
    sent.length = 0;
    await updateSettings({ allow_password_reset: false });
    await auth.requestPasswordReset("bob@example.com", null);
    expect(sent).toHaveLength(0);
    await updateSettings({ allow_password_reset: true });
  });
});

describe("wiki pages", () => {
  it("creates, versions, detects edit conflicts, searches safely", async () => {
    const p = await createPage({
      title: "Süßes Rezept",
      content: "# Kuchen\nmit Schokolade",
      parentId: null,
      userId: adminId,
    });
    expect(p.slug).toBe("susses-rezept");
    const p2 = await createPage({ title: "Süßes Rezept", content: "x", parentId: p.id, userId: adminId });
    expect(p2.slug).toBe("susses-rezept-2");
    const u = await updatePage(p.slug, {
      title: p.title,
      content: "neu Schokolade",
      parentId: null,
      expectedRev: 1,
      userId: adminId,
    });
    expect(u.rev).toBe(2);
    await expect(
      updatePage(p.slug, { title: "t", content: "stale", parentId: null, expectedRev: 1, userId: adminId }),
    ).rejects.toThrow(/Someone else/);
    expect((await search("schokol")).hits.map((r) => r.slug)).toContain("susses-rezept");
    for (const evil of ['"', "* OR 1", "a AND NOT b", "title:x", "NEAR(a b)", "'; DROP TABLE pages;--", "\\"])
      await expect(search(evil)).resolves.toBeDefined();
    expect((await search("  ")).hits).toEqual([]);
    expect(await db().prepare("SELECT COUNT(*) n FROM pages").get()).toBeTruthy();
  });
  it("blocks cycles and runaway depth", async () => {
    const a = await createPage({ title: "A1", content: "", parentId: null, userId: adminId });
    const b = await createPage({ title: "B1", content: "", parentId: a.id, userId: adminId });
    const c = await createPage({ title: "C1", content: "", parentId: b.id, userId: adminId });
    await expect(
      async () =>
        await updatePage(a.slug, { title: "A1", content: "", parentId: c.id, expectedRev: 1, userId: adminId }),
    ).rejects.toThrow(/inside itself/);
    await expect(createPage({ title: "D1", content: "", parentId: c.id, userId: adminId })).rejects.toThrow(
      /levels deep/,
    );
    expect((await getTree()).length).toBeGreaterThan(0);
    expect(await trashPage(a.slug, adminId)).toBeTruthy();
    expect((await getPage(b.slug))!.parent_id).toBeNull();
  });
});
