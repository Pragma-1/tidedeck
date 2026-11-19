import { api, json } from "@/lib/api";
import { destroySession } from "@/lib/auth";
import { cookieOpts, SESSION_COOKIE } from "@/lib/session-cookie";
export const dynamic = "force-dynamic";

export const POST = api("public", async ({ req }) => {
  await destroySession(req.cookies.get(SESSION_COOKIE)?.value);
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", cookieOpts(0));
  return res;
});
