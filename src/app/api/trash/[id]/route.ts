import { api, json } from "@/lib/api";
import { purgeTrashItem, trashId } from "@/lib/trash";
import { HttpError } from "@/lib/validate";
import { audit } from "@/lib/audit";
export const dynamic = "force-dynamic";

export const DELETE = api<{ id: string }>("admin", async ({ user, params, ip }) => {
  const item = await purgeTrashItem(trashId(params.id));
  if (!item) throw new HttpError(404, "This page is no longer in the trash.");
  await audit("page.purged", user!.id, ip, `${item.slug} (${item.title})`);
  return json({ ok: true });
});
