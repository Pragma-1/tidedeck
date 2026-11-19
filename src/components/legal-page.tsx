import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { Shell } from "./shell";
import { gate } from "@/lib/guard";
import { getLegal, isLegalEnabled, missingOperatorFields, viaCloudflare, type LegalKey } from "@/lib/legal";
import { renderMarkdown } from "@/lib/markdown";
import { getLang } from "@/lib/i18n-server";
import { formatDate, makeT } from "@/lib/i18n";
import { getSettings, renderSettings } from "@/lib/settings";

/** Privacy notice, terms and imprint: always public, even when the wiki itself requires sign-in. */
export async function LegalPage({ k }: { k: LegalKey }) {
  if (!isLegalEnabled(k, await getSettings())) notFound(); // terms and imprint can be switched off
  const user = await gate("none");
  const lang = await getLang();
  const t = makeT(lang);
  const page = await getLegal(k, lang, { cloudflare: viaCloudflare(await headers()) });
  const { html } = renderMarkdown(page.content, {
    lang,
    ...renderSettings(await getSettings()),
  });
  const missing = user?.role === "admin" && !page.custom ? await missingOperatorFields() : [];
  return (
    <Shell live={false}>
      {user?.role === "admin" && (
        <div className="notice">
          <div>
            {missing.length > 0 && (
              <>
                <strong>{t("Operator details are incomplete.")}</strong>{" "}
              </>
            )}
            {page.custom
              ? t("This page uses your own text.")
              : t("This page is generated from the operator details and the current settings.")}{" "}
            <Link href="/settings?tab=legal">{t("Edit in Settings")}</Link>
          </div>
        </div>
      )}
      <article className="legal">
        <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
        {page.updatedAt && <p className="meta">{t("Updated {date}", { date: formatDate(page.updatedAt, lang) })}</p>}
      </article>
    </Shell>
  );
}
