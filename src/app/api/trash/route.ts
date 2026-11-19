import { api, json } from "@/lib/api";
import { emptyTrash, listTrash, TRASH_DAYS } from "@/lib/trash";
import { audit } from "@/lib/audit";
export const dynamic = "force-dynamic";

// The trash is for editors and up; emptying it for good is for administrators.
export const GET = api("editor", async () => json({ days: TRASH_DAYS, items: await listTrash() }));

export const DELETE = api("admin", async ({ user, ip }) => {
  const n = await emptyTrash();
  if (n) await audit("page.trash_emptied", user!.id, ip, String(n));
  return json({ ok: true, removed: n });
});
