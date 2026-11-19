import { api, json } from "@/lib/api";
import { createSession, registerUser } from "@/lib/auth";
import { cookieOpts, SESSION_COOKIE } from "@/lib/session-cookie";
import { getSettings } from "@/lib/settings";
import { str } from "@/lib/validate";
export const dynamic = "force-dynamic";

export const POST = api("public", async ({ body, ip, req }) => {
  const b = await body();
  const id = await registerUser(
    str(b.username, "Username", { max: 32 }),
    str(b.email, "E-mail", { max: 254 }),
    str(b.password, "Password", { max: 256, trim: false }),
    ip,
  );
  const ttl = (await getSettings()).session_hours * 3600;
  const res = json({ ok: true }, 201);
  res.cookies.set(
    SESSION_COOKIE,
    await createSession(id, "full", ttl, ip, req.headers.get("user-agent")),
    cookieOpts(ttl),
  );
  return res;
});
