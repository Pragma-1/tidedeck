import "./setup-env";
import { describe, expect, it } from "vitest";
import { updateSettings, getSettings } from "@/lib/settings";
import { enabledLegalKeys, generateLegal, isLegalEnabled, missingOperatorFields, viaCloudflare } from "@/lib/legal";
import { renderMarkdown } from "@/lib/markdown";

/** Section numbers ("## 3. …") must stay 1, 2, 3 … whatever sections are switched on. */
const numbers = (md: string) => [...md.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]));
const consecutive = (ns: number[]) => ns.every((n, i) => n === i + 1);

describe("legal pages", () => {
  it("publishes all three pages by default and asks for name, address and e-mail", async () => {
    const cfg = await getSettings();
    expect(enabledLegalKeys(cfg)).toEqual(["privacy", "terms", "imprint"]);
    expect(await missingOperatorFields()).toEqual(["operator_name", "operator_address", "operator_email"]);
    const privacy = await generateLegal("privacy", "de");
    expect(privacy).not.toContain("Cloudflare");
    expect(privacy).toContain("beim bloßen Lesen werden keine Daten an Dritte übertragen");
    expect(privacy).toContain("[Bitte in den Einstellungen ergänzen]");
    expect(await generateLegal("terms", "de")).toContain("[Impressum](/imprint)");
    expect(consecutive(numbers(privacy))).toBe(true);
  });

  it("explains Cloudflare when the page is served through it — in both languages", async () => {
    const cf = { cloudflare: true };
    for (const lang of ["de", "en"] as const) {
      const md = await generateLegal("privacy", lang, cf);
      expect(md).toMatch(
        lang === "de" ? /## \d+\. Bereitstellung über Cloudflare/ : /## \d+\. Delivery via Cloudflare/,
      );
      // what is processed, that TLS ends at Cloudflare, the transfer basis and the cookies
      expect(md).toMatch(
        lang === "de" ? /HTTPS-Verbindung Ihres Browsers endet bei Cloudflare/ : /HTTPS connection ends at Cloudflare/,
      );
      expect(md).toContain("Data Privacy Framework");
      expect(md).toMatch(lang === "de" ? /Standardvertragsklauseln/ : /standard contractual clauses/);
      expect(md).toContain("https://www.cloudflare.com/privacypolicy/");
      for (const c of ["__cf_bm", "cf_clearance", "_cfuvid"]) expect(md).toContain(c);
      expect(md).toMatch(
        lang === "de"
          ? /Cloudflare als Netzwerk- und Sicherheitsdienstleister/
          : /Cloudflare as network and security provider/,
      );
      expect(consecutive(numbers(md))).toBe(true);
    }
    // the "nothing goes to third parties" promise is no longer made without qualification
    const de = await generateLegal("privacy", "de", cf);
    expect(de).not.toContain("ausgeliefert – beim bloßen Lesen werden keine Daten an Dritte übertragen");
    expect(de).toContain("Alle Anfragen laufen über das Netzwerk von Cloudflare");
    // the cookie rows render as table rows, not as stray text
    const html = renderMarkdown(de, { lang: "de" }).html;
    expect(html).toMatch(/<td[^>]*><code>__cf_bm<\/code><\/td>/);
    expect(html).not.toMatch(/\$\{/); // no template leftovers
    expect(await generateLegal("privacy", "de")).not.toContain("Cloudflare");
  });

  it("terms and imprint can be switched off; the address is then no longer required", async () => {
    await updateSettings({ legal_terms_enabled: false, legal_imprint_enabled: false });
    const cfg = await getSettings();
    expect(isLegalEnabled("privacy", cfg)).toBe(true); // the privacy notice can't be switched off
    expect(isLegalEnabled("terms", cfg)).toBe(false);
    expect(isLegalEnabled("imprint", cfg)).toBe(false);
    expect(enabledLegalKeys(cfg)).toEqual(["privacy"]);
    expect(await missingOperatorFields()).toEqual(["operator_name", "operator_email"]);
    await updateSettings({ operator_name: "Alfons Test", operator_email: "wiki@example.org" });
    expect(await missingOperatorFields()).toEqual([]);
    const privacy = await generateLegal("privacy", "de");
    expect(privacy).toContain("Alfons Test");
    expect(privacy).not.toContain("[Bitte in den Einstellungen ergänzen]"); // no address placeholder
    // terms (if someone re-enables them later) don't link to a missing imprint
    expect(await generateLegal("terms", "de")).not.toContain("/imprint");
    expect(await generateLegal("terms", "en")).not.toContain("/imprint");
    await updateSettings({ legal_terms_enabled: true, legal_imprint_enabled: true });
    expect(await missingOperatorFields()).toEqual(["operator_address"]);
  });

  it("settings only accept booleans for the switches", async () => {
    expect(await updateSettings({ legal_imprint_enabled: "false" })).toMatchObject({ ok: false });
    expect(await updateSettings({ hosting_cloudflare: true })).toMatchObject({ ok: false }); // no such setting any more
  });

  it("detects Cloudflare from the CF-Ray header it adds to every forwarded request", async () => {
    expect(viaCloudflare(new Headers({ "cf-ray": "8f1c2d3e4a5b6c7d-FRA" }))).toBe(true);
    expect(viaCloudflare(new Headers())).toBe(false);
    for (const bad of ["yes", "8f1c2d3e4a5b6c7d", "8f1c2d3e4a5b6c7d-FRA X: y", "<script>", "x".repeat(500)])
      expect(viaCloudflare(new Headers({ "cf-ray": bad }))).toBe(false);
  });
});
