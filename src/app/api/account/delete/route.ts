import { api, json } from "@/lib/api";
import { eraseOwnAccount } from "@/lib/admin";
import { cookieOpts, SESSION_COOKIE } from "@/lib/session-cookie";
import { HttpError, str } from "@/lib/validate";
export const dynamic = "force-dynamic";

// Art. 17 GDPR: only possible while signed in, and only with the current password.
export const POST = api(
  "user",
  async ({ body, user }) => {
    const b = await body();
    if (b.confirm !== true) throw new HttpError(400, "Please confirm that you want to delete your account.", "confirm");
    await eraseOwnAccount(user!, str(b.password, "Password", { max: 256, trim: false }));
    const res = json({ ok: true });
    res.cookies.set(SESSION_COOKIE, "", cookieOpts(0));
    return res;
  },
  { allowPending2fa: true },
);
