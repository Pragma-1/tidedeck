import { api } from "@/lib/api";
import { exportUserData } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { download, stamp } from "@/lib/download";
import { HttpError } from "@/lib/validate";
export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>("admin", async ({ user, ip, params }) => {
  if (!/^\d{1,9}$/.test(params.id)) throw new HttpError(404, "User not found.");
  const data = await exportUserData(Number(params.id));
  await audit("admin.export", user!.id, ip, `personal data of ${data.account.username}`, data.account.id);
  return download(
    JSON.stringify(data, null, 2),
    `personal-data-${data.account.username}-${stamp()}.json`,
    "application/json",
  );
});
