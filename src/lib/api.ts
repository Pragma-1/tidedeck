import { NextRequest, NextResponse } from "next/server";
import { ALLOWED_HOSTS, BASE_URL, LIMITS } from "./config";
import { resolveSession, type SessionUser } from "./auth";
import { clientIp, isSameOrigin } from "./net";
import { getSettings } from "./settings";
import { HttpError, isRecord } from "./validate";
import { SESSION_COOKIE } from "./session-cookie";
import { langFromRequest } from "./i18n-server";
import { makeT, type Lang, type T } from "./i18n";
import { pgCode } from "./db";

export const json = (data: unknown, status = 200, headers?: HeadersInit) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });

type Level = "public" | "user" | "editor" | "admin";
export type Ctx<P> = {
  req: NextRequest;
  user: SessionUser | null;
  ip: string | null;
  params: P;
  lang: Lang;
  t: T;
  body: (max?: number) => Promise<Record<string, unknown>>;
};

/** Reads a JSON object body with a hard byte cap (streams, so oversized bodies are never buffered whole). */
export async function readJson(req: Request, max = LIMITS.jsonBytes): Promise<Record<string, unknown>> {
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("application/json"))
    throw new HttpError(415, "Send JSON.");
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > max) throw new HttpError(413, "Request is too large.");
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Empty request.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, "Request is too large.");
    }
    chunks.push(value);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Malformed JSON.");
  }
  if (!isRecord(parsed)) throw new HttpError(400, "Expected a JSON object.");
  return parsed;
}

/**
 * Every route goes through this wrapper so authentication, role checks, CSRF protection and
 * error handling cannot be forgotten on an individual endpoint.
 */
export function api<P = Record<string, never>>(
  level: Level,
  handler: (c: Ctx<P>) => Promise<Response>,
  opts: { allowPending2fa?: boolean; readGate?: boolean } = {},
) {
  return async (req: NextRequest, route: { params: Promise<P> }): Promise<Response> => {
    let lang: Lang = "en";
    try {
      lang = langFromRequest(req);
    } catch {
      /* settings unavailable: fall back to English */
    }
    const t = makeT(lang);
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        const ok = isSameOrigin({
          origin: req.headers.get("origin"),
          secFetchSite: req.headers.get("sec-fetch-site"),
          host: req.headers.get("host"),
          baseUrl: BASE_URL,
          allowedHosts: ALLOWED_HOSTS,
        });
        if (!ok)
          throw new HttpError(
            403,
            "Cross-site request blocked. If you opened the wiki under a different address, set WIKI_BASE_URL to it.",
          );
      }
      const user = await resolveSession(req.cookies.get(SESSION_COOKIE)?.value);
      if (level !== "public" && !user) throw new HttpError(401, "Please sign in.");
      if (user) {
        if (user.needs2faSetup && !opts.allowPending2fa)
          throw new HttpError(403, "Set up two-factor authentication first.");
        if (level === "editor" && user.role === "viewer") throw new HttpError(403, "Your account is read-only.");
        if (level === "admin" && user.role !== "admin") throw new HttpError(403, "Administrators only.");
      }
      if (opts.readGate && !user && !(await getSettings()).public_read) throw new HttpError(401, "Please sign in.");
      return await handler({
        req,
        user,
        ip: clientIp(req.headers),
        params: await route.params,
        lang,
        t,
        body: (max) => readJson(req, max),
      });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: t(e.message), field: e.field }, e.status);
      // Database errors are mapped to safe, generic answers — their text (SQL, values) never reaches the client.
      const code = pgCode(e);
      if (code === "23505") return json({ error: t("This already exists.") }, 409);
      if (code === "23503" || code === "23514" || code.startsWith("22"))
        return json({ error: t("The request contains invalid values.") }, 400);
      if (code === "40001" || code === "40P01" || code === "57014" || code === "53300")
        return json({ error: t("The server is busy. Try again in a moment.") }, 503);
      if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "57P01", "57P03"].includes(code))
        return json({ error: t("The database is not reachable right now.") }, 503);
      console.error("[api] unexpected failure:", e instanceof Error ? `${code} ${e.message}`.trim() : "unknown");
      return json({ error: t("Something went wrong on the server.") }, 500);
    }
  };
}
