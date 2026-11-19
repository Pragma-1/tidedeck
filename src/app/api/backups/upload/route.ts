import { rmSync } from "node:fs";
import path from "node:path";
import { api, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { BACKUP_UPLOAD_CAP, backupBusy, importBackupZip } from "@/lib/backup";
import { assertOwner } from "@/lib/backup-auth";
import { DATA_DIR } from "@/lib/config";
import { consume } from "@/lib/rate-limit";
import { receiveUpload } from "@/lib/transfer";
import { HttpError } from "@/lib/validate";
export const dynamic = "force-dynamic";

/** A downloaded backup ZIP back in. It is decrypted and checked, then added to the list — not restored. */
export const POST = api("admin", async ({ req, user, ip }) => {
  assertOwner(user);
  if (!req.body) throw new HttpError(400, "Empty request.");
  if (!(await consume(`backup-up:${user!.id}`, 10, 3600))) throw new HttpError(429, "Slow down a little.");
  if (backupBusy()) throw new HttpError(409, "Another import or backup is running. Try again in a moment.");
  let file: string | null = null;
  try {
    file = await receiveUpload(req.body, Number(req.headers.get("content-length") || 0), {
      cap: BACKUP_UPLOAD_CAP,
      dir: path.join(/* turbopackIgnore: true */ DATA_DIR, ".backup-work", "uploads"),
    });
    const m = await importBackupZip(file);
    await audit("admin.backup_uploaded", user!.id, ip, m.id);
    return json({ id: m.id }, 201);
  } finally {
    if (file) rmSync(file, { force: true });
  }
});
