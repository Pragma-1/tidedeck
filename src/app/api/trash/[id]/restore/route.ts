import { api, json } from "@/lib/api";
import { restoreFromTrash, trashId } from "@/lib/trash";
import { audit } from "@/lib/audit";
import { consume } from "@/lib/rate-limit";
import { HttpError } from "@/lib/validate";
export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>("editor", async ({ user, params, ip }) => {
  if (!(await consume(`write:${user!.id}`, 120, 600))) throw new HttpError(429, "Slow down a little.");
  const { page, slugChanged } = await restoreFromTrash(trashId(params.id));
  await audit("page.restored", user!.id, ip, `${page.slug} (${page.title})`);
  return json({ slug: page.slug, slugChanged });
});
