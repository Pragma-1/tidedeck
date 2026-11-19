import { api, json } from "@/lib/api";
import { enableTotp } from "@/lib/auth";
import { str } from "@/lib/validate";
export const dynamic = "force-dynamic";

// Confirms a pending authenticator. The first device also returns recovery codes; later ones return null.
export const POST = api(
  "user",
  async ({ body, user, ip }) => {
    const b = await body();
    return json({ recoveryCodes: await enableTotp(user!, str(b.code, "Code", { max: 10 }), ip, b.name) });
  },
  { allowPending2fa: true },
);
