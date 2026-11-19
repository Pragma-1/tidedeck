import { api, json } from "@/lib/api";
import { disableTotp } from "@/lib/auth";
import { str } from "@/lib/validate";
export const dynamic = "force-dynamic";

export const POST = api(
  "user",
  async ({ body, user, ip }) => {
    const b = await body();
    await disableTotp(user!, str(b.password, "Password", { max: 256, trim: false }), ip);
    return json({ ok: true });
  },
  { allowPending2fa: true },
);
