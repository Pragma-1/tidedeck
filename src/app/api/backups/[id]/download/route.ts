import { api } from "@/lib/api";
import { audit } from "@/lib/audit";
import { backupZipStream } from "@/lib/backup";
import { assertOwner, backupId } from "@/lib/backup-auth";
import { consume } from "@/lib/rate-limit";
import { HttpError } from "@/lib/validate";
export const dynamic = "force-dynamic";

/** The backup's files as they are stored: still encrypted, so useless without the master key. */
export const GET = api<{ id: string }>("admin", async ({ user, params, ip }) => {
  assertOwner(user);
  const id = backupId(params.id);
  if (!(await consume(`backup-dl:${user!.id}`, 20, 3600))) throw new HttpError(429, "Slow down a little.");
  const body = await backupZipStream(id); // 404 for anything that isn't a backup
  await audit("admin.backup_downloaded", user!.id, ip, id);
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="tidewiki-backup-${id}.zip"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
