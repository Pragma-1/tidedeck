import { api, json } from "@/lib/api";
import { attemptLogin } from "@/lib/auth";
import { cookieOpts, MFA_COOKIE, SESSION_COOKIE } from "@/lib/session-cookie";
import { str } from "@/lib/validate";
import { formatDuration } from "@/lib/i18n";
export const dynamic = "force-dynamic";

export const POST = api("public", async ({ body, ip, req, t, lang }) => {
  const b = await body();
  const r = await attemptLogin(
    str(b.username, "Username or e-mail", { max: 254 }),
    str(b.password, "Password", { max: 256, trim: false }),
    ip,
    req.headers.get("user-agent"),
  );
  if (r.status === "blocked")
    return json(
      {
        error: t("Too many failed attempts. Sign-in is locked for {time}.", { time: formatDuration(r.retryIn, lang) }),
      },
      429,
    );
  if (r.status === "fail") return json({ error: t("Wrong username or password.") }, 401);
  const res = json({ ok: true, mfa: r.status === "mfa" });
  res.cookies.set(r.status === "mfa" ? MFA_COOKIE : SESSION_COOKIE, r.token, cookieOpts(r.ttl));
  return res;
});
