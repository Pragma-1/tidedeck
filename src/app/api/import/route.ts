import { rmSync } from "node:fs";
import { api, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { consume } from "@/lib/rate-limit";
import { importArchive, receiveUpload, stageUpload, type Conflict } from "@/lib/transfer";
import { HttpError } from "@/lib/validate";
import { backupBusy, createBackupInLock, exclusive } from "@/lib/backup";
export const dynamic = "force-dynamic";

// Body = a .zip (wiki export or any folder of .md files) or a single .md file.
// mode=preview only reports what would happen and keeps the file for an hour (token), so the
// arrangement made in the preview can be applied with /api/import/apply without sending it again.
// mode=apply writes right away, atomically, with the archive's own folder structure.
export const POST = api("admin", async ({ req, user, ip, t }) => {
  const sp = req.nextUrl.searchParams;
  const apply = sp.get("mode") === "apply";
  const c = sp.get("conflict");
  const conflict: Conflict = c === "overwrite" || c === "copy" ? c : "skip";
  if (!req.body) throw new HttpError(400, "Empty request.");
  if (!(await consume(`import:${user!.id}`, 30, 3600))) throw new HttpError(429, "Slow down a little.");
  if (backupBusy()) throw new HttpError(409, "Another import or backup is running. Try again in a moment.");
  let file: string | null = null;
  try {
    file = await receiveUpload(req.body, Number(req.headers.get("content-length") || 0));
    const f = file;
    const name = (sp.get("name") ?? "").slice(0, 120);
    // one import at a time, never during a backup or restore; applying first saves a safety backup
    const r = await exclusive("import", async () => {
      if (apply) await createBackupInLock("pre-import");
      return importArchive(f, { apply, conflict, userId: user!.id, singleName: name || undefined });
    });
    if (apply)
      await audit(
        "admin.import",
        user!.id,
        ip,
        `${r.created} created, ${r.updated} updated, ${r.skipped} skipped, ${r.media} files`,
      );
    let token: string | undefined;
    if (!apply) {
      token = stageUpload(f, user!.id, name);
      file = null; // kept for /api/import/apply
    }
    return json({ ...r, token, warnings: r.warnings.slice(0, 200).map((w) => t(w)) });
  } finally {
    if (file) rmSync(file, { force: true });
  }
});
