import { api, json } from "@/lib/api";
import { regenerateRecoveryCodes } from "@/lib/auth";
import { str } from "@/lib/validate";
export const dynamic = "force-dynamic";

export const POST = api("user", async ({ body, user, ip }) => {
  const b = await body();
  return json({
    recoveryCodes: await regenerateRecoveryCodes(user!, str(b.password, "Password", { max: 256, trim: false }), ip),
  });
});
