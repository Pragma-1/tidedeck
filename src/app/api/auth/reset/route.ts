import { api, json } from "@/lib/api";
import { performPasswordReset } from "@/lib/auth";
import { str } from "@/lib/validate";
export const dynamic = "force-dynamic";

export const POST = api("public", async ({ body, ip }) => {
  const b = await body();
  await performPasswordReset(
    str(b.token, "Token", { max: 200 }),
    str(b.password, "Password", { max: 256, trim: false }),
    ip,
  );
  return json({ ok: true });
});
