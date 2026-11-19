import { api, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { consume } from "@/lib/rate-limit";
import { dropStaged, importArchive, stagedUpload, type Conflict } from "@/lib/transfer";
import { HttpError } from "@/lib/validate";
import { backupBusy, createBackupInLock, exclusive } from "@/lib/backup";
export const dynamic = "force-dynamic";

/**
 * Applies a previewed import with the arrangement made in the preview.
 * Body: { token, conflict: "skip" | "overwrite" | "copy", layout: [{ key, parent, title?, include }, …] }
 * The file itself was kept by the preview (POST /api/import?mode=preview) for the same person.
 */
export const POST = api("admin", async ({ body, user, ip, t }) => {
  if (!(await consume(`import:${user!.id}`, 30, 3600))) throw new HttpError(429, "Slow down a little.");
  if (backupBusy()) throw new HttpError(409, "Another import or backup is running. Try again in a moment.");
  const b = await body(2 * 1024 * 1024);
  const token = typeof b.token === "string" ? b.token : "";
  const conflict: Conflict = b.conflict === "overwrite" || b.conflict === "copy" ? b.conflict : "skip";
  const staged = stagedUpload(token, user!.id);
  const r = await exclusive("import", async () => {
    stagedUpload(token, user!.id); // still there? (a second click may have applied it meanwhile)
    await createBackupInLock("pre-import");
    return importArchive(staged.file, {
      apply: true,
      conflict,
      userId: user!.id,
      singleName: staged.name || undefined,
      layout: b.layout,
    });
  });
  dropStaged(token);
  await audit(
    "admin.import",
    user!.id,
    ip,
    `${r.created} created, ${r.updated} updated, ${r.skipped} skipped, ${r.excluded} left out, ${r.media} files`,
  );
  return json({ ...r, warnings: r.warnings.slice(0, 200).map((w) => t(w)) });
});
