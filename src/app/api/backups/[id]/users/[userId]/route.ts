import { api, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { restoreUser } from "@/lib/backup";
import { backupId, numericId } from "@/lib/backup-auth";
import { consume } from "@/lib/rate-limit";
import { HttpError } from "@/lib/validate";
export const dynamic = "force-dynamic";

/** Brings back a deleted account (administrators: editors and viewers; the owner: also administrators). */
export const POST = api<{ id: string; userId: string }>("admin", async ({ user, params, ip }) => {
  const id = backupId(params.id);
  const uid = numericId(params.userId, "This account isn’t in the backup.");
  if (!(await consume(`write:${user!.id}`, 120, 600))) throw new HttpError(429, "Slow down a little.");
  const r = await restoreUser(id, uid, { id: user!.id, isOwner: user!.isOwner });
  await audit("admin.backup_user_restored", user!.id, ip, `${r.username} (${r.role}) from ${id}`, uid);
  return json(r);
});
