import { api, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { deleteMedia } from "@/lib/media";
import { HttpError } from "@/lib/validate";
export const dynamic = "force-dynamic";

export const DELETE = api<{ id: string }>("editor", async ({ params, user, ip }) => {
  if (!/^\d{1,9}$/.test(params.id)) throw new HttpError(404, "File not found.");
  const m = await deleteMedia(Number(params.id), user!);
  await audit("media.deleted", user!.id, ip, m.name);
  return json({ ok: true });
});
