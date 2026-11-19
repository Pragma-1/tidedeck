import { api, json } from "@/lib/api";
import { completeMfa } from "@/lib/auth";
import { cookieOpts, MFA_COOKIE, SESSION_COOKIE } from "@/lib/session-cookie";
import { str } from "@/lib/validate";
import { formatDuration } from "@/lib/i18n";
export const dynamic = "force-dynamic";

export const POST = api("public", async ({ body, ip, req, t, lang }) => {
  const b = await body();
  const r = await completeMfa(
    req.cookies.get(MFA_COOKIE)?.value,
    str(b.code, "Code", { max: 40 }),
    ip,
    req.headers.get("user-agent"),
  );
  if (r.status === "expired") {
    const res = json({ error: t("This sign-in step expired. Sign in again."), restart: true }, 401);
    res.cookies.set(MFA_COOKIE, "", cookieOpts(0));
    return res;
  }
  if (r.status === "blocked") {
    const res = json(
      {
        error:
          r.retryIn > 0
            ? t("Too many failed attempts. Sign-in is locked for {time}.", { time: formatDuration(r.retryIn, lang) })
            : t("Too many wrong codes. Sign in again."),
        restart: true,
      },
      429,
    );
    res.cookies.set(MFA_COOKIE, "", cookieOpts(0));
    return res;
  }
  if (r.status === "fail") return json({ error: t("That code is not correct.") }, 401);
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, r.token, cookieOpts(r.ttl));
  res.cookies.set(MFA_COOKIE, "", cookieOpts(0));
  return res;
});
