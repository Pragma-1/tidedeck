import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { getSettings } from "./settings";
import { isLang, makeT, type Lang } from "./i18n";

export const LANG_COOKIE = "lang";

/**
 * The wiki is German-only: a visitor switch could only ever translate the interface, never the
 * pages people write, so it is switched off. The English texts stay in the code as translation keys.
 */
export const SITE_LANG: Lang = "de";
export async function getLang(): Promise<Lang> {
  return SITE_LANG;
}
export const langFromRequest = (_req: NextRequest): Lang => SITE_LANG;
void cookies;
void getSettings;
void isLang;
export async function getT() {
  return makeT(await getLang());
}
