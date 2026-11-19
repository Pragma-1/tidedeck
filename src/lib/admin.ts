import { all, one, run, sql, tx, wipe, now, pgCode } from "./db";
import { audit, exportAudit } from "./audit";
import { checkPasswordStrength, hashPassword } from "./password";
import {
  insertUser,
  listSessions,
  requirePassword,
  revokeUserSessions,
  userById,
  validateIdentity,
  type Role,
  type SessionUser,
  type UserRow,
} from "./auth";
import { activeUserLocks, clearLock, nameKey, userKey } from "./lockout";
import { getSettings } from "./settings";
import { policyFromSettings } from "./password-policy";
import { HttpError } from "./validate";

export type AdminUser = {
  id: number;
  username: string;
  email: string;
  role: Role;
  disabled: number;
  totp_enabled: number;
  created_at: number;
  is_owner: number;
  last_login: number | null;
  locked_until: number | null;
};

export async function listUsers(): Promise<AdminUser[]> {
  const locks = await activeUserLocks();
  const rows = await all<Omit<AdminUser, "locked_until">>(
    sql`SELECT u.id, u.username, u.email, u.role, u.disabled, u.totp_enabled, u.created_at, u.is_owner,
          (SELECT MAX(ts) FROM audit_log a WHERE a.user_id = u.id AND a.event = 'login.ok') AS last_login
        FROM users u ORDER BY u.is_owner DESC, lower(u.username)`,
  );
  return rows.map((r) => ({ ...r, locked_until: locks.get(r.id) ?? null }));
}

const activeAdmins = async () =>
  (await one<{ n: number }>(sql`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0`))?.n ?? 0;
const ROLES: readonly Role[] = ["admin", "editor", "viewer"];
export const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);

/**
 * Who may touch whom:
 *  - the owner (super admin, the account created at setup) may manage everybody, but can't
 *    demote, disable or delete itself — ownership has to be handed over first;
 *  - other administrators manage editors and viewers, plus their own name/e-mail/password;
 *  - nobody but the owner creates administrators or changes an administrator account.
 */
export function assertCanManage(
  actor: Pick<UserRow, "id" | "is_owner">,
  target: Pick<UserRow, "id" | "is_owner" | "role">,
) {
  if (actor.id === target.id) return;
  if (target.is_owner) throw new HttpError(403, "Only the owner can change the owner account.");
  if (target.role === "admin" && !actor.is_owner) throw new HttpError(403, "Only the owner can manage administrators.");
}

async function checkedPassword(password: string, username: string, email: string) {
  const weak = checkPasswordStrength(password, policyFromSettings(await getSettings()), { username, email });
  if (weak) throw new HttpError(400, weak, "password");
  return hashPassword(password);
}

export async function createUser(
  actorId: number,
  input: { username: string; email: string; role: Role; password: string },
  ip: string | null,
) {
  const actor = (await userById(actorId))!;
  if (input.role === "admin" && !actor.is_owner) throw new HttpError(403, "Only the owner can create administrators.");
  validateIdentity(input.username, input.email);
  const weak = checkPasswordStrength(input.password, policyFromSettings(await getSettings()), {
    username: input.username,
    email: input.email,
  });
  if (weak) throw new HttpError(400, weak, "password");
  const id = await insertUser(input.username, input.email, input.password, input.role);
  await audit("admin.user_created", actorId, ip, `${input.username} (${input.role})`, id);
  return id;
}

export type UserPatch = {
  username?: string;
  email?: string;
  role?: Role;
  disabled?: boolean;
  password?: string;
  action?: "unlock" | "reset2fa" | "revoke_sessions" | "transfer_ownership";
};

export async function updateUser(actorId: number, targetId: number, patch: UserPatch, ip: string | null) {
  const actor0 = (await userById(actorId))!;
  const t0 = await userById(targetId);
  if (!t0) throw new HttpError(404, "User not found.");
  assertCanManage(actor0, t0);
  const username = patch.username ?? t0.username,
    email = patch.email ?? t0.email;
  if (patch.username !== undefined || patch.email !== undefined) validateIdentity(username, email);
  const newHash = patch.password !== undefined ? await checkedPassword(patch.password, username, email) : null;

  try {
    await tx(async () => {
      // re-read inside the transaction: the checks below must hold for the state that is written
      const actor = (await userById(actorId))!;
      const t = await userById(targetId);
      if (!t) throw new HttpError(404, "User not found.");
      assertCanManage(actor, t);
      const self = actor.id === t.id;
      if (username !== t.username || email !== t.email) {
        await run(sql`UPDATE users SET username = ${username}, email = ${email} WHERE id = ${t.id}`);
        const changes = [username !== t.username && `${t.username} -> ${username}`, email !== t.email && "e-mail"]
          .filter(Boolean)
          .join(", ");
        await audit("admin.user_updated", actorId, ip, changes, t.id);
      }
      if (patch.role !== undefined && patch.role !== t.role) {
        if (self) throw new HttpError(409, "You can’t change your own role.");
        if (patch.role === "admin" && !actor.is_owner)
          throw new HttpError(403, "Only the owner can create administrators.");
        if (t.role === "admin" && (await activeAdmins()) <= 1)
          throw new HttpError(409, "There must always be at least one active administrator.");
        await run(sql`UPDATE users SET role = ${patch.role} WHERE id = ${t.id}`);
        await revokeUserSessions(t.id); // privileges changed: force a fresh sign-in
        await audit("admin.role_changed", actorId, ip, `${username}: ${t.role} -> ${patch.role}`, t.id);
      }
      if (patch.disabled !== undefined && !!t.disabled !== patch.disabled) {
        if (patch.disabled && self) throw new HttpError(409, "You can’t disable your own account.");
        if (patch.disabled && t.role === "admin" && (await activeAdmins()) <= 1)
          throw new HttpError(409, "There must always be at least one active administrator.");
        await run(sql`UPDATE users SET disabled = ${patch.disabled ? 1 : 0} WHERE id = ${t.id}`);
        if (patch.disabled) await revokeUserSessions(t.id);
        await audit(patch.disabled ? "admin.user_disabled" : "admin.user_enabled", actorId, ip, username, t.id);
      }
      if (newHash) {
        await run(sql`UPDATE users SET password_hash = ${newHash}, password_changed_at = ${now()} WHERE id = ${t.id}`);
        await revokeUserSessions(t.id);
        await clearLock(userKey(t.id));
        await audit("admin.password_set", actorId, ip, username, t.id);
      }
      switch (patch.action) {
        case "unlock":
          await clearLock(userKey(t.id));
          await clearLock(nameKey(t.username));
          await clearLock(nameKey(t.email));
          await audit("admin.unlock", actorId, ip, username, t.id);
          break;
        case "reset2fa":
          await run(sql`DELETE FROM totp_devices WHERE user_id = ${t.id}`);
          await run(
            sql`UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_pending_enc = NULL, recovery_hashes = '[]'
                WHERE id = ${t.id}`,
          );
          await revokeUserSessions(t.id);
          await audit("admin.2fa_reset", actorId, ip, username, t.id);
          break;
        case "revoke_sessions":
          await revokeUserSessions(t.id);
          await audit("admin.sessions_revoked", actorId, ip, username, t.id);
          break;
        case "transfer_ownership":
          if (!actor.is_owner) throw new HttpError(403, "Only the owner can hand over ownership.");
          if (self) throw new HttpError(409, "You already own this wiki.");
          if (t.role !== "admin" || t.disabled)
            throw new HttpError(409, "Ownership can only go to an active administrator.");
          // old owner first: the database allows only one owner at any moment
          await run(sql`UPDATE users SET is_owner = 0 WHERE id = ${actor.id}`);
          await run(sql`UPDATE users SET is_owner = 1 WHERE id = ${t.id}`);
          await audit("admin.owner_transferred", actorId, ip, `${actor.username} -> ${username}`, t.id);
          break;
      }
    });
  } catch (e) {
    if (pgCode(e) === "23505") throw new HttpError(409, "That username or e-mail address is already in use.");
    throw e;
  }
}

/* ------------------------------------------------------------------ GDPR */

/**
 * Art. 17 erasure. Removes the account and every piece of personal data tied to it: sessions,
 * reset links, lock-out and rate-limit counters, and all security-log entries by or about the
 * person (their IP addresses included). Pages they wrote stay, because a wiki page belongs to
 * everyone — only the author link is cut, so history shows "deleted account".
 */
export async function eraseUser(targetId: number, actor: { id: number; ip: string | null } | "self") {
  await tx(async () => {
    const t = await userById(targetId);
    if (!t) throw new HttpError(404, "User not found.");
    const idents = [t.username, t.email].map((x) => x.toLowerCase());
    await run(sql`DELETE FROM audit_log WHERE user_id = ${t.id} OR target_id = ${t.id}`);
    await run(
      sql`DELETE FROM lockouts WHERE user_id = ${t.id} OR key = ANY(${[userKey(t.id), nameKey(idents[0]), nameKey(idents[1])]})`,
    );
    const keys = [
      `reauth:${t.id}`,
      `totp-enable:${t.id}`,
      `reset:mail:${idents[1]}`,
      `search:u:${t.id}`,
      `mailtest:${t.id}`,
      `audit:blocked:${t.id}`,
    ];
    await run(sql`DELETE FROM rate_limits WHERE key = ANY(${keys})`);
    await run(sql`DELETE FROM users WHERE id = ${t.id}`); // sessions, devices, reset tokens cascade; authorship -> NULL
    // A minimal, non-identifying record that an erasure happened (no name, no address, no IP of the person).
    if (actor === "self") {
      await audit("account.erased", null, null, `#${t.id}`);
      await run(sql`INSERT INTO erasures(user_id, erased_at) VALUES (${t.id}, ${now()}) ON CONFLICT DO NOTHING`);
    } else await audit("admin.user_deleted", actor.id, actor.ip, `#${t.id}`);
  });
  // gone from the database files too, not just marked as deleted (see wipe)
  await wipe(["users", "audit_log", "sessions", "lockouts", "rate_limits", "totp_devices", "reset_tokens"]);
}

export async function deleteUser(actorId: number, targetId: number, ip: string | null) {
  const actor = (await userById(actorId))!;
  const t = await userById(targetId);
  if (!t) throw new HttpError(404, "User not found.");
  if (t.id === actorId) throw new HttpError(409, "Delete your own account from your account page.");
  assertCanManage(actor, t);
  if (t.role === "admin" && !t.disabled && (await activeAdmins()) <= 1)
    throw new HttpError(409, "There must always be at least one active administrator.");
  await eraseUser(t.id, { id: actorId, ip });
}

/**
 * After a full restore: accounts their owners erased (Art. 17) are erased again, so an older
 * backup can never undo an erasure request.
 */
export async function reapplyErasures(): Promise<number> {
  const ids = await all<{ user_id: number }>(
    sql`SELECT e.user_id FROM erasures e JOIN users u ON u.id = e.user_id WHERE u.is_owner = 0`,
  );
  for (const { user_id } of ids) await eraseUser(user_id, "self");
  return ids.length;
}

/** Self-service erasure from the account page (password required). */
export async function eraseOwnAccount(user: SessionUser, password: string) {
  await requirePassword(user, password);
  const u = (await userById(user.id))!;
  if (u.is_owner)
    throw new HttpError(409, "You own this wiki. Hand ownership to another administrator in Settings first.");
  if (u.role === "admin" && !u.disabled && (await activeAdmins()) <= 1)
    throw new HttpError(409, "There must always be at least one active administrator.");
  await eraseUser(user.id, "self");
}

/** Art. 15 / 20: everything stored about one person, as plain JSON (no hashes, no secrets). */
export async function exportUserData(userId: number) {
  const u = await userById(userId);
  if (!u) throw new HttpError(404, "User not found.");
  const iso = (t: number | null) => (t ? new Date(t * 1000).toISOString() : null);
  const devices = await all<{ name: string; created_at: number; last_used_at: number | null }>(
    sql`SELECT name, created_at, last_used_at FROM totp_devices WHERE user_id = ${u.id} ORDER BY id`,
  );
  return {
    exported_at: new Date().toISOString(),
    account: {
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role,
      owner: !!u.is_owner,
      disabled: !!u.disabled,
      two_factor_enabled: !!u.totp_enabled,
      authenticator_devices: devices.map((d) => ({
        name: d.name,
        added_at: iso(d.created_at),
        last_used_at: iso(d.last_used_at),
      })),
      created_at: iso(u.created_at),
      password_changed_at: iso(u.password_changed_at),
    },
    sessions: (await listSessions(u.id)).map((s) => ({
      created_at: iso(s.created_at),
      last_seen: iso(s.last_seen),
      ip: s.ip,
      user_agent: s.user_agent,
    })),
    security_log: (await exportAudit({ userId: u.id })).map((a) => ({
      id: a.id,
      at: iso(a.ts),
      event: a.event,
      by: a.username,
      about: a.target_name,
      ip: a.ip,
      detail: a.detail,
    })),
    pages_created: await all(
      sql`SELECT slug, title, created_at FROM pages WHERE created_by = ${u.id} ORDER BY created_at`,
    ),
    files_uploaded: await all(
      sql`SELECT name, original_name, mime, size, created_at FROM media WHERE created_by = ${u.id} ORDER BY created_at`,
    ),
    page_versions_written: await all(
      sql`SELECT p.slug, p.title, r.rev, r.created_at FROM page_revisions r JOIN pages p ON p.id = r.page_id
          WHERE r.author_id = ${u.id} ORDER BY r.created_at`,
    ),
    // deleted pages waiting in the trash (removed for good after 30 days)
    trash: {
      pages_created: await all(
        sql`SELECT slug, title, created_at, deleted_at FROM trash WHERE created_by = ${u.id} ORDER BY deleted_at`,
      ),
      pages_deleted: await all(
        sql`SELECT slug, title, deleted_at FROM trash WHERE deleted_by = ${u.id} ORDER BY deleted_at`,
      ),
      page_versions_written: await all(
        sql`SELECT t.slug, t.title, r.rev, r.created_at FROM trash_revisions r JOIN trash t ON t.id = r.trash_id
            WHERE r.author_id = ${u.id} ORDER BY r.created_at`,
      ),
    },
    note: "Stored secrets (password hash, two-factor secret, recovery codes) are intentionally not included.",
  };
}
