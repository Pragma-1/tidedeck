import { api, json } from "@/lib/api";
import { verifyBackup } from "@/lib/backup";
import { backupId } from "@/lib/backup-auth";
import { consume } from "@/lib/rate-limit";
import { HttpError } from "@/lib/validate";
export const dynamic = "force-dynamic";

/** Decrypts and checks every record and file of a backup without restoring anything. */
export const POST = api<{ id: string }>("admin", async ({ user, params }) => {
  if (!(await consume(`backup-verify:${user!.id}`, 20, 3600))) throw new HttpError(429, "Slow down a little.");
  return json(await verifyBackup(backupId(params.id)));
});
