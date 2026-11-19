import { requirePassword, type SessionUser } from "./auth";
import { HttpError } from "./validate";

/**
 * Who may do what with backups:
 *  - list, look inside, back up now, verify: administrators (the owner is one);
 *  - restore one page: administrators;
 *  - restore one account: administrators for editors and viewers, the owner for administrators;
 *  - restore everything, download, upload, delete, change storage or schedule: the owner only —
 *    a backup holds every account's password hash and 2FA data, and a full restore decides who
 *    is administrator. Full restore and storage changes also ask for the owner's password.
 */
export function assertOwner(user: SessionUser | null) {
  if (!user?.isOwner) throw new HttpError(403, "Only the owner of the wiki can do this.");
}

export async function assertOwnerPassword(user: SessionUser | null, password: unknown) {
  assertOwner(user);
  await requirePassword(user!, password);
}

export const backupId = (s: string) => {
  if (!/^\d{8}-\d{6}-[0-9a-f]{6}$/.test(s)) throw new HttpError(404, "Backup not found.");
  return s;
};
export const numericId = (s: string, what: string) => {
  if (!/^[1-9]\d{0,15}$/.test(s) || !Number.isSafeInteger(Number(s))) throw new HttpError(404, what);
  return Number(s);
};
