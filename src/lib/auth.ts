import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BASE_URL, DATA_DIR, ISSUER } from "./config";
import { all, one, run, sql, tx, now, pgCode } from "./db";
import { decrypt, encrypt, hmac, randomToken, safeEqual, sha256 } from "./crypto";
import { checkPasswordStrength, hashPassword, needsRehash, verifyDummy, verifyPassword } from "./password";
import { consume, isBlocked, purgeRateLimits, recordFailure } from "./rate-limit";
import { clearLock, lockedFor, nameKey, purgeLockouts, registerFailure, userKey } from "./lockout";
import { translate, type Lang } from "./i18n";
import { getSettings } from "./settings";
import { generateSecret, otpauthUri, verifyTotp } from "./totp";
import { audit } from "./audit";
import { EMAIL_RE, HttpError, USERNAME_RE } from "./validate";
import { isMailConfigured, sendMail } from "./mail";
import { renderMail } from "./mail-template";
import { policyFromSettings } from "./password-policy";
import { mfaRequiredFor } from "./roles";
import { seedPages } from "./seed";

export type Role = "admin" | "editor" | "viewer";
export type UserRow = {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  role: Role;
  disabled: number;
  totp_secret_enc: string | null;
  totp_pending_enc: string | null;
  totp_enabled: number;
  totp_last_step: number;
  recovery_hashes: string;
  created_at: number;
  password_changed_at: number;
  is_owner: number;
};
export type SessionUser = {
  id: number;
  username: string;
  email: string;
  role: Role;
  totpEnabled: boolean;
  isOwner: boolean;
  needs2faSetup: boolean;
  mfaRequired: boolean;
  sessionHash: string;
};

/**
 * Per-IP throttle that only applies when the client IP is actually known (trusted proxy configured).
 * Without it, a shared "unknown" bucket would let one attacker lock every visitor out, so we skip it
 * and rely on per-account lock-out plus the capped Argon2 concurrency instead.
 */
const ipAllowed = async (key: string, ip: string | null, limit: number, windowSec: number) =>
  ip === null || (await consume(`${key}:${ip}`, limit, windowSec));

const MFA_TTL = 5 * 60;
const MFA_MAX_ATTEMPTS = 5;

export const userById = (id: number) => one<UserRow>(sql`SELECT * FROM users WHERE id = ${id}`);
// usernames can't contain "@", so a sign-in name matches at most one account
const userByLogin = (login: string) =>
  one<UserRow>(
    sql`SELECT * FROM users WHERE lower(username) = lower(${login}) OR lower(email) = lower(${login}) LIMIT 1`,
  );
export const userCount = async () => (await one<{ n: number }>(sql`SELECT COUNT(*) AS n FROM users`))?.n ?? 0;

/* ---------------------------------------------------------------- sessions */

/** Browser identification as stored: printable characters only, short. */
const cleanUa = (ua: string | null) => (ua ? ua.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200) : null);

export async function createSession(
  userId: number,
  kind: "full" | "mfa",
  ttlSec: number,
  ip: string | null,
  ua: string | null,
) {
  const token = randomToken(32);
  const t = now();
  await tx(async () => {
    await run(
      sql`INSERT INTO sessions(id_hash, user_id, kind, created_at, last_seen, expires_at, ip, user_agent)
          VALUES (${sha256(token)}, ${userId}, ${kind}, ${t}, ${t}, ${t + ttlSec}, ${ip}, ${cleanUa(ua)})`,
    );
    // At most 30 sessions per person: the oldest ones are dropped.
    await run(
      sql`DELETE FROM sessions WHERE user_id = ${userId} AND id_hash IN
          (SELECT id_hash FROM sessions WHERE user_id = ${userId} ORDER BY last_seen DESC OFFSET 30)`,
    );
  });
  return token; // only the hash is stored: a leaked DB can't be replayed as cookies
}

export async function resolveSession(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length < 40 || token.length > 100 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const hash = sha256(token);
  const s = await one<{ user_id: number; expires_at: number; last_seen: number }>(
    sql`SELECT user_id, expires_at, last_seen FROM sessions WHERE id_hash = ${hash} AND kind = 'full'`,
  );
  if (!s) return null;
  const t = now();
  if (s.expires_at <= t) {
    await run(sql`DELETE FROM sessions WHERE id_hash = ${hash}`);
    return null;
  }
  const u = await userById(s.user_id);
  if (!u || u.disabled) return null;
  if (t - s.last_seen > 60) await run(sql`UPDATE sessions SET last_seen = ${t} WHERE id_hash = ${hash}`);
  const mfaRequired = mfaRequiredFor(await getSettings(), u.role);
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    totpEnabled: !!u.totp_enabled,
    isOwner: !!u.is_owner,
    needs2faSetup: mfaRequired && !u.totp_enabled,
    mfaRequired,
    sessionHash: hash,
  };
}

export async function destroySession(token: string | undefined) {
  if (token) await run(sql`DELETE FROM sessions WHERE id_hash = ${sha256(token)}`);
}
export const revokeUserSessions = (userId: number, exceptHash?: string) =>
  run(sql`DELETE FROM sessions WHERE user_id = ${userId} AND id_hash IS DISTINCT FROM ${exceptHash ?? null}::text`);

export function listSessions(userId: number) {
  return all<{ id_hash: string; created_at: number; last_seen: number; ip: string | null; user_agent: string | null }>(
    sql`SELECT id_hash, created_at, last_seen, ip, user_agent FROM sessions
        WHERE user_id = ${userId} AND kind = 'full' AND expires_at > ${now()} ORDER BY last_seen DESC`,
  );
}

/** Public handle for a session: derived from (never equal to) the stored hash, which is derived from the cookie. */
export const sessionHandle = (idHash: string) => sha256(`session-handle:${idHash}`).slice(0, 24);

/** Signs out one of the person's own sessions. Returns whether it was the current one. */
export async function revokeOwnSession(
  user: SessionUser,
  handle: string,
  ip: string | null,
): Promise<{ current: boolean }> {
  if (!/^[0-9a-f]{24}$/.test(handle)) throw new HttpError(404, "That session no longer exists.");
  const target = (await listSessions(user.id)).find((s) => safeEqual(sessionHandle(s.id_hash), handle));
  if (!target) throw new HttpError(404, "That session no longer exists.");
  await run(sql`DELETE FROM sessions WHERE id_hash = ${target.id_hash} AND user_id = ${user.id}`);
  await audit("session.revoked", user.id, ip);
  return { current: target.id_hash === user.sessionHash };
}

export async function revokeOtherSessions(user: SessionUser, ip: string | null): Promise<number> {
  const n = await run(sql`DELETE FROM sessions WHERE user_id = ${user.id} AND id_hash <> ${user.sessionHash}`);
  await audit("session.revoked_others", user.id, ip, String(n));
  return n;
}

async function housekeeping() {
  if (Math.random() < 0.05) {
    await run(sql`DELETE FROM sessions WHERE expires_at <= ${now()}`);
    await run(sql`DELETE FROM reset_tokens WHERE expires_at <= ${now()}`);
    await purgeRateLimits();
    await purgeLockouts();
  }
}

/* ------------------------------------------------------------------- login */

export type LoginResult =
  | { status: "ok"; token: string; ttl: number }
  | { status: "mfa"; token: string; ttl: number }
  | { status: "fail" }
  | { status: "blocked"; retryIn: number };

const unknownNameRows = async () =>
  (
    await one<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM (SELECT 1 FROM lockouts WHERE user_id IS NULL LIMIT 20000) x`,
    )
  )?.n ?? 0;
const failKey = (u: UserRow | undefined, ident: string) => (u ? userKey(u.id) : nameKey(ident));

/** Counts a failure; when it triggers a lock, records it in the security log. */
async function fail(key: string, user: UserRow | undefined, ip: string | null) {
  // Counters for names that don't exist are bounded, so spraying random names can't grow the table forever.
  if (!user && (await unknownNameRows()) >= 20_000) return;
  const locked = await registerFailure(key, (await getSettings()).max_login_attempts, user?.id ?? null);
  if (locked && user) await audit("login.locked", user.id, ip, `${Math.round(locked / 60)} min`, user.id);
}

export async function attemptLogin(
  ident: string,
  password: string,
  ip: string | null,
  ua: string | null,
): Promise<LoginResult> {
  await housekeeping();
  const cfg = await getSettings();
  // Coarse per-IP throttle (only when a trusted proxy tells us the real client IP).
  if (!(await ipAllowed("login:ip", ip, 40, 900))) return { status: "blocked", retryIn: 900 };
  const user = await userByLogin(ident);
  const key = failKey(user, ident);
  const wait = await lockedFor(key);
  if (wait > 0) {
    // Log a blocked attempt at most once a minute per account, so hammering a locked account can't flood the log.
    if (user && (await consume(`audit:blocked:${user.id}`, 1, 60))) await audit("login.blocked", user.id, ip);
    return { status: "blocked", retryIn: wait };
  }

  if (!user) {
    await verifyDummy(password);
    await fail(key, undefined, ip);
    return { status: "fail" };
  }
  const ok = await verifyPassword(user.password_hash, password);
  if (!ok || user.disabled) {
    await fail(key, user, ip);
    await audit("login.failed", user.id, ip);
    return { status: "fail" };
  }
  if (needsRehash(user.password_hash)) {
    const h = await hashPassword(password);
    await run(sql`UPDATE users SET password_hash = ${h} WHERE id = ${user.id}`);
  }
  if (user.totp_enabled) {
    const token = await createSession(user.id, "mfa", MFA_TTL, ip, ua);
    return { status: "mfa", token, ttl: MFA_TTL };
  }
  await clearLock(key);
  const ttl = cfg.session_hours * 3600;
  await audit("login.ok", user.id, ip);
  return { status: "ok", token: await createSession(user.id, "full", ttl, ip, ua), ttl };
}

const normRecovery = (c: string) => c.replace(/[\s-]/g, "").toLowerCase();

export async function completeMfa(
  mfaToken: string | undefined,
  code: string,
  ip: string | null,
  ua: string | null,
): Promise<
  | { status: "ok"; token: string; ttl: number }
  | { status: "fail" }
  | { status: "blocked"; retryIn: number }
  | { status: "expired" }
> {
  if (!mfaToken || mfaToken.length > 100 || !/^[A-Za-z0-9_-]+$/.test(mfaToken)) return { status: "expired" };
  const hash = sha256(mfaToken);
  // Counting the attempt and reading the session is one statement: parallel guesses can't share a count.
  const s = await one<{ user_id: number; expires_at: number; attempts: number }>(
    sql`UPDATE sessions SET attempts = attempts + 1 WHERE id_hash = ${hash} AND kind = 'mfa'
        RETURNING user_id, expires_at, attempts`,
  );
  if (!s || s.expires_at <= now()) {
    if (s) await run(sql`DELETE FROM sessions WHERE id_hash = ${hash}`);
    return { status: "expired" };
  }
  const user = await userById(s.user_id);
  const cfg = await getSettings();
  if (!user || user.disabled || !user.totp_enabled) return { status: "expired" };
  const key = userKey(user.id);
  const wait = await lockedFor(key);
  if (wait > 0 || s.attempts > MFA_MAX_ATTEMPTS) {
    await run(sql`DELETE FROM sessions WHERE id_hash = ${hash}`);
    return { status: "blocked", retryIn: wait };
  }

  let ok = false;
  const clean = code.trim();
  if (/^\d{6}$/.test(clean)) {
    for (const d of await deviceRows(user.id)) {
      let secret: string;
      try {
        secret = decrypt(d.secret_enc, `user:${user.id}:totp`);
      } catch {
        continue;
      }
      const step = verifyTotp(secret, clean, Date.now(), d.last_step);
      // Atomic replay protection per device: a time-step can only ever be accepted once.
      if (
        step !== null &&
        (await run(
          sql`UPDATE totp_devices SET last_step = ${step}, last_used_at = ${now()}
              WHERE id = ${d.id} AND user_id = ${user.id} AND last_step < ${step}`,
        )) === 1
      ) {
        ok = true;
        break;
      }
    }
  } else {
    const h = hmac(normRecovery(clean));
    ok = await tx(async () => {
      const list = JSON.parse((await userById(user.id))!.recovery_hashes) as string[];
      const idx = list.findIndex((x) => safeEqual(x, h));
      if (idx < 0) return false;
      list.splice(idx, 1); // recovery codes are single-use
      await run(sql`UPDATE users SET recovery_hashes = ${JSON.stringify(list)} WHERE id = ${user.id}`);
      return true;
    });
    if (ok) await audit("2fa.recovery_used", user.id, ip);
  }
  if (!ok) {
    await fail(key, user, ip);
    await audit("2fa.failed", user.id, ip);
    return { status: "fail" };
  }

  // the pending session is consumed exactly once, even if two correct codes arrive together
  if ((await run(sql`DELETE FROM sessions WHERE id_hash = ${hash}`)) !== 1) return { status: "expired" };
  await clearLock(key);
  const ttl = cfg.session_hours * 3600;
  await audit("login.ok", user.id, ip, "2fa");
  return { status: "ok", token: await createSession(user.id, "full", ttl, ip, ua), ttl };
}

/* ------------------------------------------------------------ registration */

export function validateIdentity(username: string, email: string) {
  if (!USERNAME_RE.test(username))
    throw new HttpError(400, "Username: 3–32 characters, letters, digits, dot, dash or underscore.", "username");
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid e-mail address.", "email");
}

export async function insertUser(username: string, email: string, password: string, role: Role): Promise<number> {
  const hash = await hashPassword(password);
  try {
    const t = now();
    const r = await one<{ id: number }>(
      sql`INSERT INTO users(username, email, password_hash, role, created_at, password_changed_at)
          VALUES (${username}, ${email}, ${hash}, ${role}, ${t}, ${t}) RETURNING id`,
    );
    return r!.id;
  } catch (e) {
    if (pgCode(e) === "23505") throw new HttpError(409, "That username or e-mail address is already in use.");
    throw e;
  }
}

export async function registerUser(username: string, email: string, password: string, ip: string | null) {
  const cfg = await getSettings();
  if (!cfg.allow_registration) throw new HttpError(403, "Registration is turned off.");
  if (!(await consume(`register:${ip ?? "any"}`, ip ? 5 : 30, 3600)))
    throw new HttpError(429, "Too many sign-ups. Try again later.");
  validateIdentity(username, email);
  const weak = checkPasswordStrength(password, policyFromSettings(cfg), { username, email });
  if (weak) throw new HttpError(400, weak, "password");
  const id = await insertUser(username, email, password, cfg.registration_role);
  await audit("user.registered", id, ip);
  return id;
}

/* ------------------------------------------------------------ first-run setup */

const SETUP_FILE = () => path.join(/* turbopackIgnore: true */ DATA_DIR, "setup-token");

export async function ensureSetupToken(): Promise<string | null> {
  if ((await userCount()) > 0) {
    rmSync(SETUP_FILE(), { force: true });
    return null;
  }
  if (process.env.WIKI_SETUP_TOKEN && process.env.WIKI_SETUP_TOKEN.length >= 16) return process.env.WIKI_SETUP_TOKEN;
  if (!existsSync(SETUP_FILE())) writeFileSync(SETUP_FILE(), randomBytes(18).toString("base64url"), { mode: 0o600 });
  return readFileSync(SETUP_FILE(), "utf8").trim();
}

export async function setupAdmin(token: string, username: string, email: string, password: string, ip: string | null) {
  if (!(await ipAllowed("setup", ip, 10, 900))) throw new HttpError(429, "Too many attempts. Try again later.");
  const expected = await ensureSetupToken();
  if (!expected) throw new HttpError(403, "Setup is already complete.");
  // Global (not per-IP) limit on wrong tokens: without a trusted proxy the client IP is unknown,
  // and a short custom WIKI_SETUP_TOKEN must not be guessable by unlimited tries.
  if (await isBlocked("setup:badtoken", 10))
    throw new HttpError(429, "Too many wrong setup tokens. Try again in 15 minutes.");
  if (!safeEqual(token.trim(), expected)) {
    await recordFailure("setup:badtoken", 900);
    await audit("setup.bad_token", null, ip);
    throw new HttpError(403, "That setup token is not correct.");
  }
  validateIdentity(username, email);
  const policy = policyFromSettings(await getSettings());
  const weak = checkPasswordStrength(
    password,
    { ...policy, minLength: Math.max(12, policy.minLength) },
    { username, email },
  );
  if (weak) throw new HttpError(400, weak, "password");
  const hash = await hashPassword(password);
  const id = await tx(async () => {
    // closes the race between two setup requests (serializable: the second one sees the first)
    if ((await userCount()) > 0) throw new HttpError(403, "Setup is already complete.");
    const t = now();
    const r = await one<{ id: number }>(
      sql`INSERT INTO users(username, email, password_hash, role, is_owner, created_at, password_changed_at)
          VALUES (${username}, ${email}, ${hash}, 'admin', 1, ${t}, ${t}) RETURNING id`,
    );
    await seedPages(r!.id, (await getSettings()).language);
    return r!.id;
  });
  rmSync(SETUP_FILE(), { force: true });
  await audit("setup.admin_created", id, ip);
  return id;
}

/* ---------------------------------------------------------- password reset */

const RESET_TTL = 30 * 60;

/** Always resolves quietly: callers must answer identically whether or not the e-mail exists. */
export async function requestPasswordReset(email: string, ip: string | null, lang?: Lang): Promise<void> {
  const cfg = await getSettings();
  lang ??= cfg.language;
  if (!cfg.allow_password_reset || !(await isMailConfigured())) return;
  if (!(await ipAllowed("reset:ip", ip, 10, 3600))) return;
  if (!(await consume("reset:global", 300, 3600))) return; // hard ceiling, also bounds the per-address counters
  if (!(await consume(`reset:mail:${email.toLowerCase()}`, 3, 3600))) return;
  const user = await one<UserRow>(sql`SELECT * FROM users WHERE lower(email) = lower(${email})`);
  if (!user || user.disabled) return;
  const token = randomToken(32);
  await tx(async () => {
    await run(sql`DELETE FROM reset_tokens WHERE user_id = ${user.id}`); // only the newest link works
    await run(
      sql`INSERT INTO reset_tokens(token_hash, user_id, expires_at) VALUES (${sha256(token)}, ${user.id}, ${now() + RESET_TTL})`,
    );
  });
  await audit("reset.requested", user.id, ip);
  // The token travels in the URL fragment so it never reaches server logs or Referer headers.
  const link = `${BASE_URL}/reset#token=${token}`;
  const site = cfg.site_name;
  const t = (x: string, p?: Record<string, string | number>) => translate(lang, x, p);
  const mail = renderMail({
    site,
    heading: t("Reset your password"),
    preheader: t("Open the link within 30 minutes to choose a new password."),
    paragraphs: [
      t("Hello {name},", { name: user.username }),
      t("someone asked to reset the password for your {site} account.", { site }),
      t("Open this link within 30 minutes to choose a new password:"),
    ],
    button: { label: t("Choose a new password"), url: link },
    linkFallback: t("If the button doesn’t work, copy this link into your browser:"),
    footer: t("If you didn’t ask for this, ignore this e-mail — your password stays unchanged."),
  });
  void sendMail(user.email, t("{site}: reset your password", { site }), mail.text, mail.html).catch((e) =>
    console.error("[mail] reset mail failed:", e?.message),
  );
}

export async function performPasswordReset(token: string, password: string, ip: string | null) {
  if (!(await ipAllowed("reset:use", ip, 20, 3600))) throw new HttpError(429, "Too many attempts. Try again later.");
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) throw new HttpError(400, "This reset link is invalid or has expired.");
  const row = await one<{ user_id: number; expires_at: number }>(
    sql`SELECT user_id, expires_at FROM reset_tokens WHERE token_hash = ${sha256(token)}`,
  );
  if (!row || row.expires_at <= now()) throw new HttpError(400, "This reset link is invalid or has expired.");
  const user = await userById(row.user_id);
  if (!user || user.disabled) throw new HttpError(400, "This reset link is invalid or has expired.");
  const weak = checkPasswordStrength(password, policyFromSettings(await getSettings()), {
    username: user.username,
    email: user.email,
  });
  if (weak) throw new HttpError(400, weak, "password");
  const hash = await hashPassword(password);
  const used = await tx(async () => {
    // DELETE … rowcount makes the token strictly single-use even under concurrency.
    if ((await run(sql`DELETE FROM reset_tokens WHERE token_hash = ${sha256(token)}`)) !== 1) return false;
    await run(sql`DELETE FROM reset_tokens WHERE user_id = ${user.id}`);
    await run(sql`UPDATE users SET password_hash = ${hash}, password_changed_at = ${now()} WHERE id = ${user.id}`);
    await revokeUserSessions(user.id);
    return true;
  });
  if (!used) throw new HttpError(400, "This reset link is invalid or has expired.");
  await clearLock(userKey(user.id));
  await audit("password.reset", user.id, ip);
  // 2FA stays enforced: a reset never bypasses the second factor.
}

/* ----------------------------------------------------------------- account */

export async function changePassword(user: SessionUser, current: string, next: string, ip: string | null) {
  const row = (await userById(user.id))!;
  if (!(await verifyPassword(row.password_hash, current)))
    throw new HttpError(403, "Your current password is not correct.", "current");
  const weak = checkPasswordStrength(next, policyFromSettings(await getSettings()), {
    username: row.username,
    email: row.email,
  });
  if (weak) throw new HttpError(400, weak, "password");
  const h = await hashPassword(next);
  await tx(async () => {
    await run(sql`UPDATE users SET password_hash = ${h}, password_changed_at = ${now()} WHERE id = ${user.id}`);
    await revokeUserSessions(user.id, user.sessionHash);
  });
  await audit("password.changed", user.id, ip);
}

/** Re-authentication for sensitive actions; shared rate limit (10 per 15 minutes per person). */
export async function requirePassword(user: SessionUser, password: unknown) {
  if (!(await consume(`reauth:${user.id}`, 10, 900))) throw new HttpError(429, "Too many attempts. Try again later.");
  const row = await userById(user.id);
  if (
    !row ||
    typeof password !== "string" ||
    password.length > 1024 ||
    !(await verifyPassword(row.password_hash, password))
  )
    throw new HttpError(403, "Your password is not correct.", "password");
}

/* ------------------------------------------------------ authenticator devices */

export const MAX_DEVICES = 10;
type DeviceRow = {
  id: number;
  name: string;
  secret_enc: string;
  last_step: number;
  created_at: number;
  last_used_at: number | null;
};
const deviceRows = (userId: number) =>
  all<DeviceRow>(sql`SELECT * FROM totp_devices WHERE user_id = ${userId} ORDER BY id`);
export const listDevices = async (userId: number) =>
  (await deviceRows(userId)).map(({ id, name, created_at, last_used_at }) => ({ id, name, created_at, last_used_at }));

const DEVICE_NAME_RE = /^[^\u0000-\u001f\u007f<>]{1,40}$/u;
const cleanDeviceName = (name: unknown, fallback: string) => {
  const n = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!n) return fallback;
  if (!DEVICE_NAME_RE.test(n)) throw new HttpError(400, "Device name: up to 40 characters.", "name");
  return n;
};

/** Starts adding an authenticator (first one or another one). The secret stays pending until a code proves it works. */
export async function beginTotpSetup(user: SessionUser, password: string) {
  await requirePassword(user, password);
  if ((await deviceRows(user.id)).length >= MAX_DEVICES)
    throw new HttpError(400, `You can register at most ${MAX_DEVICES} authenticator devices.`);
  const secret = generateSecret();
  await run(sql`UPDATE users SET totp_pending_enc = ${encrypt(secret, `user:${user.id}:totp`)} WHERE id = ${user.id}`);
  const site = (await getSettings()).site_name.replace(/[:]/g, "") || ISSUER;
  return { secret, uri: otpauthUri(secret, user.email, site) };
}

export function makeRecoveryCodes(): { plain: string[]; hashes: string[] } {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const plain = Array.from({ length: 10 }, () => {
    const b = randomBytes(10);
    const s = Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  return { plain, hashes: plain.map((c) => hmac(normRecovery(c))) };
}

/** Confirms the pending authenticator. Returns fresh recovery codes for the first device, null for additional ones. */
export async function enableTotp(
  user: SessionUser,
  code: string,
  ip: string | null,
  name?: unknown,
): Promise<string[] | null> {
  const row = (await userById(user.id))!;
  if (!row.totp_pending_enc) throw new HttpError(400, "Start the setup again.");
  if (!(await consume(`totp-enable:${user.id}`, 10, 900)))
    throw new HttpError(429, "Too many attempts. Try again later.");
  const devName = cleanDeviceName(name, "Authenticator");
  const secret = decrypt(row.totp_pending_enc, `user:${user.id}:totp`);
  const step = verifyTotp(secret, code.trim());
  if (step === null)
    throw new HttpError(400, "That code didn’t match. Check the time on your phone and try again.", "code");
  const pending = row.totp_pending_enc;
  const secretEnc = encrypt(secret, `user:${user.id}:totp`);
  const rc = makeRecoveryCodes();
  return tx(async () => {
    const count = (await deviceRows(user.id)).length;
    if (count >= MAX_DEVICES)
      throw new HttpError(400, `You can register at most ${MAX_DEVICES} authenticator devices.`);
    // Only the pending secret that was just verified is consumed (a parallel setup can't swap it).
    if (
      (await run(
        sql`UPDATE users SET totp_pending_enc = NULL WHERE id = ${user.id} AND totp_pending_enc = ${pending}`,
      )) !== 1
    )
      throw new HttpError(400, "Start the setup again.");
    await run(
      sql`INSERT INTO totp_devices(user_id, name, secret_enc, last_step, created_at)
          VALUES (${user.id}, ${devName}, ${secretEnc}, ${step}, ${now()})`,
    );
    if (count === 0) {
      await run(
        sql`UPDATE users SET totp_enabled = 1, recovery_hashes = ${JSON.stringify(rc.hashes)} WHERE id = ${user.id}`,
      );
      await audit("2fa.enabled", user.id, ip, devName);
      return rc.plain;
    }
    await audit("2fa.device_added", user.id, ip, devName);
    return null;
  });
}

export async function renameDevice(user: SessionUser, id: number, name: unknown, ip: string | null) {
  const n = cleanDeviceName(name, "");
  if (!n) throw new HttpError(400, "Device name: up to 40 characters.", "name");
  if ((await run(sql`UPDATE totp_devices SET name = ${n} WHERE id = ${id} AND user_id = ${user.id}`)) !== 1)
    throw new HttpError(404, "That device no longer exists.");
  await audit("2fa.device_renamed", user.id, ip, n);
}

/** Removes one authenticator. Removing the last one turns two-factor off — unless the role requires it. */
export async function removeDevice(user: SessionUser, id: number, password: string, ip: string | null) {
  await requirePassword(user, password);
  await tx(async () => {
    const devs = await deviceRows(user.id);
    const dev = devs.find((d) => d.id === id);
    if (!dev) throw new HttpError(404, "That device no longer exists.");
    const last = devs.length === 1;
    if (last && mfaRequiredFor(await getSettings(), (await userById(user.id))!.role))
      throw new HttpError(
        403,
        "Two-factor authentication is required for your role. Add another device before removing this one.",
      );
    await run(sql`DELETE FROM totp_devices WHERE id = ${id} AND user_id = ${user.id}`);
    if (last) {
      await run(
        sql`UPDATE users SET totp_enabled = 0, totp_pending_enc = NULL, recovery_hashes = '[]' WHERE id = ${user.id}`,
      );
      await audit("2fa.disabled", user.id, ip, dev.name);
    } else await audit("2fa.device_removed", user.id, ip, dev.name);
  });
}

/** Turns two-factor off completely (all devices, all recovery codes). */
export async function disableTotp(user: SessionUser, password: string, ip: string | null) {
  if (mfaRequiredFor(await getSettings(), (await userById(user.id))!.role))
    throw new HttpError(403, "Two-factor authentication is required for your role.");
  await requirePassword(user, password);
  await tx(async () => {
    await run(sql`DELETE FROM totp_devices WHERE user_id = ${user.id}`);
    await run(
      sql`UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_pending_enc = NULL, recovery_hashes = '[]'
          WHERE id = ${user.id}`,
    );
  });
  await audit("2fa.disabled", user.id, ip);
}

export async function regenerateRecoveryCodes(
  user: SessionUser,
  password: string,
  ip: string | null,
): Promise<string[]> {
  await requirePassword(user, password);
  if (!user.totpEnabled) throw new HttpError(400, "Turn on two-factor authentication first.");
  const rc = makeRecoveryCodes();
  await run(sql`UPDATE users SET recovery_hashes = ${JSON.stringify(rc.hashes)} WHERE id = ${user.id}`);
  await audit("2fa.recovery_regenerated", user.id, ip);
  return rc.plain;
}

/* ---------------------------------------------------------- profile */

/** Changes the person's own username and/or e-mail address. Needs the current password. */
export async function updateProfile(
  user: SessionUser,
  input: { username: string; email: string; password: string },
  ip: string | null,
  lang?: Lang,
) {
  const cfg = await getSettings();
  lang ??= cfg.language;
  const username = input.username.trim(),
    email = input.email.trim();
  validateIdentity(username, email);
  const row = (await userById(user.id))!;
  const nameChanged = username !== row.username,
    mailChanged = email !== row.email;
  if (!nameChanged && !mailChanged) return { changed: false };
  await requirePassword(user, input.password);
  try {
    await tx(async () => {
      await run(sql`UPDATE users SET username = ${username}, email = ${email} WHERE id = ${user.id}`);
      // Reset links already sent to the old address stop working.
      if (mailChanged) await run(sql`DELETE FROM reset_tokens WHERE user_id = ${user.id}`);
    });
  } catch (e) {
    if (pgCode(e) === "23505") throw new HttpError(409, "That username or e-mail address is already in use.");
    throw e;
  }
  if (nameChanged) await audit("account.username_changed", user.id, ip, `${row.username} → ${username}`);
  if (mailChanged) {
    await audit("account.email_changed", user.id, ip);
    // Tell the old address, so a hijacked session can't quietly move the account away.
    if (await isMailConfigured()) {
      const site = cfg.site_name;
      const t = (x: string, p?: Record<string, string | number>) => translate(lang, x, p);
      const mail = renderMail({
        site,
        heading: t("Your e-mail address was changed"),
        paragraphs: [
          t("Hello {name},", { name: username }),
          t("the e-mail address of your {site} account was just changed. Messages now go to the new address.", {
            site,
          }),
        ],
        facts: [[t("New address"), email.replace(/^(.).*(@.*)$/, "$1…$2")]],
        footer: t("If this wasn’t you, contact an administrator right away."),
      });
      void sendMail(row.email, t("{site}: e-mail address changed", { site }), mail.text, mail.html).catch((e) =>
        console.error("[mail] notice failed:", e?.message),
      );
    }
  }
  return { changed: true };
}

export const recoveryCodesLeft = async (userId: number) =>
  (JSON.parse((await userById(userId))?.recovery_hashes ?? "[]") as string[]).length;
