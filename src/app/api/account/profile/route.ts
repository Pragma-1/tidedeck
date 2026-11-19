import { api, json } from "@/lib/api";
import { updateProfile } from "@/lib/auth";
import { str } from "@/lib/validate";
export const dynamic = "force-dynamic";

// Own username / e-mail. The current password is required for any change.
export const PUT = api(
  "user",
  async ({ body, user, ip, lang }) => {
    const b = await body();
    const r = await updateProfile(
      user!,
      {
        username: str(b.username, "Username", { max: 32 }),
        email: str(b.email, "E-mail", { max: 254 }),
        password: str(b.password, "Password", { max: 256, trim: false, optional: true }),
      },
      ip,
      lang,
    );
    return json(r);
  },
  { allowPending2fa: true },
);
