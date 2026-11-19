import { cookies, headers } from "next/headers";
import { cache } from "react";
import { SECURE_COOKIES } from "./config";
import { clientIp } from "./net";
import { resolveSession, type SessionUser } from "./auth";

// __Host- prefix (HTTPS only) pins the cookie to this exact host and forbids Domain/path tricks.
const P = SECURE_COOKIES ? "__Host-" : "";
export const SESSION_COOKIE = `${P}wiki_session`;
export const MFA_COOKIE = `${P}wiki_mfa`;

export const cookieOpts = (maxAge: number) => ({
  httpOnly: true,
  secure: SECURE_COOKIES,
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});

export async function setCookie(name: string, value: string, maxAgeSec: number) {
  (await cookies()).set(name, value, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSec,
  });
}
export async function clearCookie(name: string) {
  (await cookies()).set(name, "", { httpOnly: true, secure: SECURE_COOKIES, sameSite: "lax", path: "/", maxAge: 0 });
}
export async function readCookie(name: string) {
  return (await cookies()).get(name)?.value;
}

/** Per-request cached current user (null when signed out). */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> =>
  resolveSession(await readCookie(SESSION_COOKIE)),
);

export async function requestMeta() {
  const h = await headers();
  return { ip: clientIp(h), ua: h.get("user-agent") };
}
