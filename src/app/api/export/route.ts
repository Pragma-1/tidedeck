import { api } from "@/lib/api";
import { audit } from "@/lib/audit";
import { stamp } from "@/lib/download";
import { consume } from "@/lib/rate-limit";
import { exportWikiZip } from "@/lib/transfer";
import { HttpError } from "@/lib/validate";
export const dynamic = "force-dynamic";

// Whole wiki (pages as Markdown folders + media) as one ZIP, streamed.
export const GET = api("admin", async ({ user, ip }) => {
  if (!(await consume(`export:${user!.id}`, 10, 3600))) throw new HttpError(429, "Slow down a little.");
  await audit("admin.export", user!.id, ip, "whole wiki (zip)");
  return new Response(exportWikiZip(), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="tidewiki-${stamp()}.zip"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
