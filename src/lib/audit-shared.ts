import { msg } from "./msg";

export const CATEGORIES = {
  signin: { label: msg("Sign-in"), prefixes: ["login.", "session."] },
  twofa: { label: msg("Two-factor"), prefixes: ["2fa."] },
  password: { label: msg("Password"), prefixes: ["password.", "reset."] },
  users: {
    label: msg("User management"),
    prefixes: [
      "admin.user_",
      "admin.role_",
      "admin.unlock",
      "admin.2fa_",
      "admin.sessions_",
      "admin.password_",
      "admin.owner_",
      "user.",
      "account.",
    ],
  },
  settings: {
    label: msg("Settings"),
    prefixes: ["admin.settings", "admin.export", "admin.import", "admin.legal", "admin.mail", "admin.backup", "media."],
  },
  pages: { label: msg("Pages"), prefixes: ["page."] },
  setup: { label: msg("Setup"), prefixes: ["setup."] },
} as const;
export type Category = keyof typeof CATEGORIES;

/** Human labels for every event the app writes. Unknown events fall back to their raw name. */
export const EVENT_LABELS: Record<string, string> = {
  "login.ok": msg("Signed in"),
  "login.failed": msg("Wrong password"),
  "login.blocked": msg("Sign-in attempt while locked"),
  "login.locked": msg("Account locked"),
  "2fa.failed": msg("Wrong two-factor code"),
  "2fa.enabled": msg("Two-factor turned on"),
  "2fa.disabled": msg("Two-factor turned off"),
  "2fa.recovery_used": msg("Recovery code used"),
  "2fa.recovery_regenerated": msg("New recovery codes"),
  "2fa.device_added": msg("Authenticator device added"),
  "2fa.device_removed": msg("Authenticator device removed"),
  "2fa.device_renamed": msg("Authenticator device renamed"),
  "session.revoked": msg("Session signed out"),
  "session.revoked_others": msg("All other sessions signed out"),
  "account.username_changed": msg("Username changed"),
  "account.email_changed": msg("E-mail address changed"),
  "admin.mail_test": msg("Test e-mail sent"),
  "password.changed": msg("Password changed"),
  "password.reset": msg("Password reset by e-mail link"),
  "reset.requested": msg("Password reset requested"),
  "user.registered": msg("Self-registered"),
  "account.exported": msg("Personal data downloaded"),
  "account.erased": msg("Account and personal data erased"),
  "admin.user_created": msg("User created"),
  "admin.user_updated": msg("User details changed"),
  "admin.user_disabled": msg("User disabled"),
  "admin.user_enabled": msg("User enabled"),
  "admin.user_deleted": msg("User deleted"),
  "admin.role_changed": msg("Role changed"),
  "admin.unlock": msg("Lock-out lifted"),
  "admin.2fa_reset": msg("Two-factor reset"),
  "admin.sessions_revoked": msg("Signed out everywhere"),
  "admin.password_set": msg("Password set by an administrator"),
  "admin.owner_transferred": msg("Ownership transferred"),
  "admin.settings_changed": msg("Settings changed"),
  "admin.export": msg("Log or data exported"),
  "admin.legal_changed": msg("Legal page changed"),
  "admin.import": msg("Content imported"),
  "media.uploaded": msg("File uploaded"),
  "media.deleted": msg("File deleted"),
  "page.created": msg("Page created"),
  "page.deleted": msg("Page deleted"),
  "page.trashed": msg("Page moved to the trash"),
  "page.restored": msg("Page restored from the trash"),
  "page.version_restored": msg("Older version restored"),
  "page.purged": msg("Page deleted permanently"),
  "page.trash_emptied": msg("Trash emptied"),
  "admin.backup_created": msg("Backup created"),
  "admin.backup_deleted": msg("Backup deleted"),
  "admin.backup_restored": msg("Backup restored"),
  "admin.backup_uploaded": msg("Backup uploaded"),
  "admin.backup_downloaded": msg("Backup downloaded"),
  "admin.backup_page_restored": msg("Backup page restored"),
  "admin.backup_user_restored": msg("Backup account restored"),
  "setup.admin_created": msg("Wiki set up"),
  "setup.bad_token": msg("Wrong setup token"),
};

export type AuditRow = {
  id: number;
  ts: number;
  event: string;
  ip: string | null;
  detail: string | null;
  user_id: number | null;
  username: string | null;
  target_id: number | null;
  target_name: string | null;
};

export const eventId = (id: number) => `EV-${String(id).padStart(6, "0")}`;
