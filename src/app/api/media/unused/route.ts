import { api, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { deleteUnusedMedia } from "@/lib/media";
import { consume } from "@/lib/rate-limit";
import { HttpError } from "@/lib/validate";
export const dynamic = "force-dynamic";

/**
 * Deletes every file that no page and no page in the trash shows, plus stray files on disk
 * without an entry. Administrators only.
 */
export const POST = api("admin", async ({ user, ip }) => {
  if (!(await consume(`media-delete:${user!.id}`, 60, 600))) throw new HttpError(429, "Slow down a little.");
  const r = await deleteUnusedMedia();
  await audit(
    "media.deleted",
    user!.id,
    ip,
    `unused: ${r.files.length} files${r.strays ? `, ${r.strays} stray` : ""} (${Math.round(r.bytes / 1024)} KB)`,
  );
  return json({ deleted: r.files.length, strays: r.strays, bytes: r.bytes });
});
