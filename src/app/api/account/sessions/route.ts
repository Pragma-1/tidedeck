import { api, json } from "@/lib/api";
import { revokeOtherSessions, revokeOwnSession } from "@/lib/auth";
import { cookieOpts, SESSION_COOKIE } from "@/lib/session-cookie";
import { HttpError, str } from "@/lib/validate";
export const dynamic = "force-dynamic";

/** Sign out one of your own sessions, or all others. */
export const POST = api(
  "user",
  async ({ body, user, ip }) => {
    const b = await body();
    if (b.action === "revoke_others") return json({ ok: true, revoked: await revokeOtherSessions(user!, ip) });
    if (b.action !== "revoke") throw new HttpError(400, "Unknown action.");
    const { current } = await revokeOwnSession(user!, str(b.id, "Session", { max: 64 }), ip);
    const res = json({ ok: true, current });
    if (current) res.cookies.set(SESSION_COOKIE, "", cookieOpts(0));
    return res;
  },
  { allowPending2fa: true },
);
