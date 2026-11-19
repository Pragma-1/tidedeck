import { api, json } from "@/lib/api";
import { changePassword } from "@/lib/auth";
import { str } from "@/lib/validate";
export const dynamic = "force-dynamic";

export const POST = api(
  "user",
  async ({ body, user, ip }) => {
    const b = await body();
    await changePassword(
      user!,
      str(b.current, "Current password", { max: 256, trim: false }),
      str(b.password, "New password", { max: 256, trim: false }),
      ip,
    );
    return json({ ok: true });
  },
  { allowPending2fa: true },
);
