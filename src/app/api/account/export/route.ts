import { api } from "@/lib/api";
import { exportUserData } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { download, stamp } from "@/lib/download";
export const dynamic = "force-dynamic";

// Art. 15 / 20 GDPR: every signed-in person can download what the wiki stores about them.
export const GET = api(
  "user",
  async ({ user, ip }) => {
    const data = await exportUserData(user!.id);
    await audit("account.exported", user!.id, ip);
    return download(JSON.stringify(data, null, 2), `my-data-${stamp()}.json`, "application/json");
  },
  { allowPending2fa: true },
);
