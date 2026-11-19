import { api, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { generateLegal, getLegal, isLegalKey, resetLegal, setLegal, viaCloudflare } from "@/lib/legal";
import { isLang } from "@/lib/i18n";
import { HttpError, str } from "@/lib/validate";
export const dynamic = "force-dynamic";

type P = { key: string };
const keyOf = (k: string) => {
  if (!isLegalKey(k)) throw new HttpError(404, "Page not found.");
  return k;
};
const langOf = (l: unknown) => {
  if (!isLang(l)) throw new HttpError(400, "Bad request.");
  return l;
};

export const GET = api<P>("admin", async ({ params, req }) => {
  const key = keyOf(params.key),
    lang = langOf(req.nextUrl.searchParams.get("lang"));
  const opts = { cloudflare: viaCloudflare(req.headers) };
  return json({ ...(await getLegal(key, lang, opts)), template: await generateLegal(key, lang, opts) });
});

export const PUT = api<P>("admin", async ({ params, body, user, ip }) => {
  const key = keyOf(params.key);
  const b = await body(128 * 1024);
  const lang = langOf(b.lang);
  await setLegal(key, lang, str(b.content, "Content", { max: 100_000, trim: false }), user!.id);
  await audit("admin.legal_changed", user!.id, ip, `${key} (${lang})`);
  return json({ ok: true });
});

export const DELETE = api<P>("admin", async ({ params, req, user, ip }) => {
  const key = keyOf(params.key),
    lang = langOf(req.nextUrl.searchParams.get("lang"));
  if (await resetLegal(key, lang))
    await audit("admin.legal_changed", user!.id, ip, `${key} (${lang}) reset to template`);
  return json({ ok: true });
});
