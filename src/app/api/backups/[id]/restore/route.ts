import { api, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getManifest, restoreBackup } from "@/lib/backup";
import { assertOwner, assertOwnerPassword, backupId } from "@/lib/backup-auth";
import { userById } from "@/lib/auth";
export const dynamic = "force-dynamic";

/** Replaces the whole wiki with the backup. Owner + password; everyone is signed out afterwards. */
export const POST = api<{ id: string }>("admin", async ({ body, user, params, ip }) => {
  assertOwner(user);
  const id = backupId(params.id);
  await getManifest(id); // unknown backup: 404 before the password check spends an attempt
  const b = await body(2048);
  await assertOwnerPassword(user, b.password);
  const r = await restoreBackup(id);
  // written into the restored database; the account may not exist there (then without a user)
  const by = (await userById(user!.id))?.username === user!.username ? user!.id : null;
  await audit("admin.backup_restored", by, ip, `${id} by ${user!.username} (safety copy ${r.safety})`);
  return json({ ok: true, safety: r.safety, missingFiles: r.missing });
});
