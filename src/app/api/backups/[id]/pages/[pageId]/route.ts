import { api, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { restorePage } from "@/lib/backup";
import { backupId, numericId } from "@/lib/backup-auth";
import { consume } from "@/lib/rate-limit";
import { HttpError } from "@/lib/validate";
export const dynamic = "force-dynamic";

/** Restores one page from a backup (administrators). Never overwrites: adds a version or recreates the page. */
export const POST = api<{ id: string; pageId: string }>("admin", async ({ user, params, ip }) => {
  const id = backupId(params.id);
  const pageId = numericId(params.pageId, "This page isn’t in the backup.");
  if (!(await consume(`write:${user!.id}`, 120, 600))) throw new HttpError(429, "Slow down a little.");
  const r = await restorePage(id, pageId, user!.id);
  await audit("admin.backup_page_restored", user!.id, ip, `${r.slug} from ${id} (${r.mode})`);
  return json(r);
});
