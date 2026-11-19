import { one, run, sql, now } from "./db";
import { TRUSTED_PROXY_HOPS } from "./config";
import { isMailConfigured } from "./mail";
import { getSettings, type Settings } from "./settings";
import type { Lang } from "./i18n";
import { HttpError } from "./validate";

export const LEGAL_KEYS = ["privacy", "terms", "imprint"] as const;
export type LegalKey = (typeof LEGAL_KEYS)[number];
export const isLegalKey = (k: unknown): k is LegalKey =>
  typeof k === "string" && (LEGAL_KEYS as readonly string[]).includes(k);

/** The privacy notice is always published; terms and imprint can be switched off (e.g. for a private wiki). */
type LegalSwitches = Pick<
  Settings,
  "legal_terms_enabled" | "legal_imprint_enabled" | "legal_privacy_enabled" | "legal_privacy_url"
>;
export const isLegalEnabled = (key: LegalKey, cfg: LegalSwitches): boolean =>
  key === "terms" ? cfg.legal_terms_enabled : key === "imprint" ? cfg.legal_imprint_enabled : cfg.legal_privacy_enabled;
export const enabledLegalKeys = (cfg: LegalSwitches) => LEGAL_KEYS.filter((k) => isLegalEnabled(k, cfg));
import { privacyHref } from "./settings";
export { privacyHref };

/** Date the built-in templates were last revised (shown as "Stand"). */
const TEMPLATE_DATE = { de: "November 2026", en: "November 2026" };

export const LEGAL_TITLES: Record<LegalKey, Record<Lang, string>> = {
  privacy: { de: "Datenschutzerklärung", en: "Privacy notice" },
  terms: { de: "Nutzungsbedingungen", en: "Terms of use" },
  imprint: { de: "Impressum", en: "Imprint" },
};

/** Operator text is inserted into Markdown; escape everything that could change formatting or create links. */
const esc = (s: string) => s.replace(/[\\`*_{}[\]()#+!|<>~=^:-]/g, (c) => `\\${c}`);
const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => esc(l.trim()))
    .filter(Boolean)
    .join("  \n");

type Ctx = { cfg: Settings; lang: Lang; mail: boolean; ipKnown: boolean; cloudflare: boolean };

/** A section pointing to the privacy notice, or nothing when there is none to point to. */
function privacySection(c: Ctx, textWithLinkLabel: string, without = ""): string {
  const href = privacyHref(c.cfg);
  return href ? `${textWithLinkLabel}(${href}).` : without;
}

function operatorBlock({ cfg, lang }: Ctx): string {
  const missing = lang === "de" ? "[Bitte in den Einstellungen ergänzen]" : "[Please add in Settings]";
  // The postal address is only required for an imprint; without one, name and e-mail identify the controller.
  const address = cfg.operator_address ? lines(cfg.operator_address) : cfg.legal_imprint_enabled ? missing : "";
  const parts = [cfg.operator_name ? esc(cfg.operator_name) : missing, address].filter(Boolean);
  if (cfg.operator_email) parts.push(`${lang === "de" ? "E-Mail" : "E-mail"}: ${esc(cfg.operator_email)}`);
  if (cfg.operator_phone) parts.push(`${lang === "de" ? "Telefon" : "Phone"}: ${esc(cfg.operator_phone)}`);
  return parts.join("  \n");
}

/* ------------------------------------------------------------------ privacy */

function privacyDe(c: Ctx): string {
  const { cfg } = c;
  const s: string[] = [];
  s.push(`# Datenschutzerklärung

Diese Erklärung informiert Sie nach Art. 13 und 14 der Datenschutz-Grundverordnung (DSGVO) darüber, welche personenbezogenen Daten dieses Wiki („${esc(cfg.site_name)}“) verarbeitet, wozu, auf welcher Rechtsgrundlage und wie lange.

## 1. Verantwortlicher

${operatorBlock(c)}`);
  if (cfg.dpo_contact)
    s.push(`## 2. Datenschutzbeauftragte(r)

${lines(cfg.dpo_contact)}`);
  s.push(`## ${cfg.dpo_contact ? 3 : 2}. Das Wichtigste in Kürze

- Kein Tracking, keine Analyse-Werkzeuge, keine Werbung, keine Social-Media-Plugins.
${
  c.cloudflare
    ? "- Alle Anfragen laufen über das Netzwerk von Cloudflare (siehe „Bereitstellung über Cloudflare“). Schriftarten und alle Programmteile kommen von diesem Server; darüber hinaus werden beim bloßen Lesen keine Daten an Dritte übertragen."
    : "- Schriftarten und alle Programmteile werden von diesem Server ausgeliefert – beim bloßen Lesen werden keine Daten an Dritte übertragen."
}
- Inhalte anderer Anbieter (Videos von YouTube oder Vimeo${cfg.external_media_autoload ? "" : ", Bilder von fremden Servern"}) werden erst geladen, wenn Sie das ausdrücklich anklicken.
- Mit einem Konto können Sie Ihre Daten jederzeit selbst herunterladen und Ihr Konto löschen (Seite „Ihr Konto“).`);
  let n = cfg.dpo_contact ? 4 : 3;
  s.push(`## ${n++}. Aufruf der Seiten

Beim Aufruf überträgt Ihr Browser technisch notwendig Ihre IP-Adresse, Datum und Uhrzeit, die angeforderte Adresse sowie Browser-Angaben (User-Agent). Diese Daten werden nur verarbeitet, um die Seite auszuliefern; die Anwendung selbst schreibt dafür kein Zugriffsprotokoll. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse am sicheren Betrieb). ${c.cloudflare ? "Alle Anfragen erreichen den Server über Cloudflare; Einzelheiten im folgenden Abschnitt." : "Falls der Betreiber einen vorgeschalteten Webserver oder Reverse-Proxy einsetzt, kann dieser eigene Protokolle führen; Einzelheiten erfahren Sie beim Verantwortlichen."}`);
  if (c.cloudflare)
    s.push(`## ${n++}. Bereitstellung über Cloudflare

Dieses Wiki wird über das Netzwerk der Cloudflare, Inc. (USA) bereitgestellt, etwa über einen Cloudflare Tunnel. Ihr Browser verbindet sich dabei nicht direkt mit dem Server des Betreibers, sondern mit einem Rechenzentrum von Cloudflare, das die Anfrage an den Server weiterleitet. So ist der Server vor Angriffen geschützt und muss selbst nicht aus dem Internet erreichbar sein.

Für jede Anfrage verarbeitet Cloudflare insbesondere Ihre IP-Adresse, Datum und Uhrzeit, die aufgerufene Adresse, Browser-Angaben (User-Agent) und technische Merkmale der Verbindung, um die Seite auszuliefern sowie Angriffe und automatisierte Zugriffe zu erkennen und abzuwehren. Die verschlüsselte HTTPS-Verbindung Ihres Browsers endet bei Cloudflare; Cloudflare kann die Inhalte von Anfragen und Antworten deshalb technisch einsehen – auch Eingaben wie Anmeldedaten. Cloudflare verarbeitet diese Daten im Auftrag des Betreibers (Art. 28 DSGVO). Wie lange Cloudflare Daten speichert, ergibt sich aus der Datenschutzerklärung von Cloudflare.

Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; das berechtigte Interesse liegt in einem sicheren und verfügbaren Betrieb, ohne dass der Server direkt aus dem Internet erreichbar ist. Cloudflare kann Daten in die USA und andere Länder übermitteln. Cloudflare ist nach dem EU-US Data Privacy Framework zertifiziert; die Übermittlung erfolgt auf Grundlage des Angemessenheitsbeschlusses der EU-Kommission vom 10. Juli 2023 (Art. 45 DSGVO) und ergänzend auf Grundlage von Standardvertragsklauseln (Art. 46 Abs. 2 lit. c DSGVO). Weitere Informationen: [Datenschutzerklärung von Cloudflare](https://www.cloudflare.com/privacypolicy/).`);
  s.push(`## ${n++}. Cookies und ähnliche Techniken

| Name | Zweck | Speicherdauer |
|:-----|:------|:--------------|
| \`wiki_session\` | hält Sie nach der Anmeldung angemeldet | bis zur Abmeldung, höchstens ${cfg.session_hours} Stunden |
| \`wiki_mfa\` | Zwischenschritt der Zwei-Faktor-Anmeldung | 5 Minuten |
| \`lang\`, \`theme\` | merkt sich Sprache bzw. helles/dunkles Design, wenn Sie umschalten | 1 Jahr |
| \`tidewiki:draft:…\` (lokaler Speicher) | ungespeicherte Entwürfe im Editor, nur in Ihrem Browser | bis zum Speichern oder Verwerfen |${
    c.cloudflare
      ? `
| \`__cf_bm\` | Cloudflare: unterscheidet Menschen von automatisierten Zugriffen (Bot-Schutz) | 30 Minuten ab der letzten Aktivität |
| \`cf_clearance\` | Cloudflare: Nachweis, dass eine Sicherheitsprüfung bestanden wurde | von Cloudflare festgelegt |
| \`_cfuvid\` | Cloudflare: unterscheidet Besucher hinter derselben IP-Adresse für Zugriffsbegrenzungen | von Cloudflare festgelegt |`
      : ""
  }

Alle Cookies und Einträge sind für den von Ihnen gewünschten Dienst unbedingt erforderlich bzw. speichern nur eine von Ihnen getroffene Einstellung (§ 25 Abs. 2 Nr. 2 TDDDG); eine Einwilligung ist dafür nicht nötig.${c.cloudflare ? " Die Cloudflare-Cookies setzt Cloudflare nur, wenn die jeweilige Schutzfunktion aktiv ist; sie dienen ausschließlich der Sicherheit." : ""} Es werden keine Cookies zu Werbe- oder Analysezwecken gesetzt.`);
  s.push(`## ${n++}. Benutzerkonto

Für ein Konto verarbeiten wir Benutzername, E-Mail-Adresse, Rolle, das Passwort (ausschließlich als Argon2id-Hash, nie im Klartext), bei aktivierter Zwei-Faktor-Authentifizierung je Authenticator-Gerät den von Ihnen vergebenen Namen, das verschlüsselte TOTP-Geheimnis und den Zeitpunkt der letzten Verwendung sowie gehashte Wiederherstellungscodes, Zeitpunkte von Anlage und Passwortänderung sowie aktive Sitzungen (Zeitpunkt, Browser${c.ipKnown ? ", IP-Adresse" : ""}).

Zweck ist die Bereitstellung der Funktionen für angemeldete Personen (Seiten anlegen und bearbeiten). Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Nutzungsverhältnis). Die Angaben sind für ein Konto erforderlich; ohne sie können Sie das Wiki nur lesen. Die Daten werden gespeichert, bis Sie Ihr Konto löschen oder es gelöscht wird.`);
  s.push(`## ${n++}. Inhalte und Versionsverlauf

Seiten, die Sie anlegen oder bearbeiten, werden mit Ihrem Benutzernamen und dem Zeitpunkt im Versionsverlauf gespeichert, damit Änderungen nachvollziehbar bleiben (Art. 6 Abs. 1 lit. f DSGVO). Hochgeladene Bilder werden vor dem Speichern von Metadaten wie Aufnahmeort (GPS), Kameradaten und Kommentaren bereinigt; bei Videos ist das technisch nicht möglich – bitte laden Sie nur Videos hoch, deren Inhalt und Metadaten Sie weitergeben dürfen.

Gelöschte Seiten kommen mit ihrem Versionsverlauf zunächst für 30 Tage in einen Papierkorb, den nur Personen mit Schreibrechten sehen, damit versehentliches Löschen rückgängig gemacht werden kann; danach werden sie endgültig gelöscht.

Wenn Sie Ihr Konto löschen, bleiben die Inhalte als Teil des gemeinsamen Wikis erhalten; die Verknüpfung zu Ihrer Person wird entfernt (als Autor erscheint „gelöschtes Konto“). Persönliche Angaben, die Sie selbst in den Text einer Seite geschrieben haben, entfernen Sie bitte vor der Löschung oder wenden sich an den Verantwortlichen.`);
  s.push(`## ${n++}. Datensicherung

Zum Schutz vor Datenverlust werden vom gesamten Wiki – einschließlich der Konten und des Sicherheitsprotokolls – Sicherungskopien angelegt (Art. 6 Abs. 1 lit. f, Art. 32 Abs. 1 lit. c DSGVO).${backupDe(cfg)} Sicherungen werden vor dem Speichern mit AES-256 verschlüsselt und sind nur dem Betreiber zugänglich. ${cfg.backup_target === "s3" ? `Sie liegen bei einem S3-Speicherdienst (${s3HostOf(cfg)}), der dabei als Auftragsverarbeiter (Art. 28 DSGVO) tätig ist und nur die verschlüsselten Daten erhält.` : "Sie liegen auf Speicher des Betreibers."} Sie werden ausschließlich verwendet, um das Wiki oder einzelne Seiten und Konten nach einem Fehler oder Datenverlust wiederherzustellen. Daten, die nach einer Sicherung gelöscht wurden, bleiben in dieser Sicherung enthalten, bis sie selbst gelöscht wird. Haben Sie Ihr Konto selbst gelöscht, wird es auch beim Wiederherstellen einer älteren Sicherung nicht wiederhergestellt.`);
  s.push(`## ${n++}. Sicherheitsprotokoll

Zum Schutz vor Missbrauch protokollieren wir sicherheitsrelevante Ereignisse (z. B. Anmeldungen, Fehlversuche, Sperren, Änderungen an Konten und Einstellungen) mit Zeitpunkt, betroffenem Konto${c.ipKnown ? " und IP-Adresse" : ""}. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (Schutz der Konten und des Systems). ${c.ipKnown ? `IP-Adressen werden nach ${cfg.ip_retention_days} Tagen entfernt, ` : ""}Einträge werden nach ${cfg.log_retention_days} Tagen automatisch gelöscht. Einsehen können das Protokoll nur Administratoren.`);
  if (c.mail)
    s.push(`## ${n++}. E-Mails

Wenn Sie ein neues Passwort anfordern, senden wir Ihnen einen Link an Ihre E-Mail-Adresse. Ändern Sie Ihre E-Mail-Adresse, benachrichtigen wir die bisherige Adresse einmalig, damit eine unbefugte Änderung auffällt. Der Versand erfolgt über den E-Mail-Dienst des Betreibers, der dabei als Auftragsverarbeiter (Art. 28 DSGVO) tätig sein kann. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Der Link ist 30 Minuten gültig und wird danach gelöscht.`);
  s.push(`## ${n++}. Eingebettete Videos und externe Inhalte

Videos von **YouTube** (Google Ireland Limited, Irland; Mutterkonzern Google LLC, USA) und **Vimeo** (Vimeo.com, Inc., USA) werden nicht automatisch geladen. Erst wenn Sie auf „Video laden“ klicken, stellt Ihr Browser eine Verbindung zum Anbieter her; dabei werden mindestens Ihre IP-Adresse, Browser-Angaben und die aufgerufene Seite übertragen, und der Anbieter kann Cookies oder ähnliche Techniken einsetzen. YouTube-Videos werden über den Modus mit erweitertem Datenschutz (youtube-nocookie.com) eingebunden.

Rechtsgrundlage ist Ihre Einwilligung durch den Klick (Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG); sie gilt nur für das jeweilige Video und wird nicht gespeichert. Daten können dabei in die USA übermittelt werden. Soweit der Anbieter nach dem EU-US Data Privacy Framework zertifiziert ist, erfolgt dies auf Grundlage des Angemessenheitsbeschlusses der EU-Kommission vom 10. Juli 2023 (Art. 45 DSGVO), andernfalls auf Grundlage Ihrer Einwilligung (Art. 49 Abs. 1 lit. a DSGVO). Informationen der Anbieter: [Google](https://policies.google.com/privacy), [Vimeo](https://vimeo.com/privacy).

${
  cfg.external_media_autoload
    ? "Bilder und Videodateien, die Autorinnen und Autoren von fremden Servern einbinden, werden direkt von diesen Servern geladen; dabei erhält der jeweilige Server Ihre IP-Adresse und Browser-Angaben (Art. 6 Abs. 1 lit. f DSGVO)."
    : "Bilder und Videodateien von fremden Servern werden ebenfalls erst nach einem Klick geladen; erst dann erhält der jeweilige Server Ihre IP-Adresse und Browser-Angaben."
}
Links zu Videos anderer Plattformen öffnen die Seite des Anbieters; dort gilt dessen Datenschutzerklärung.`);
  s.push(`## ${n++}. Empfänger

Ihre Daten werden nicht verkauft und nicht zu Werbezwecken weitergegeben. Empfänger können nur technische Dienstleister des Betreibers sein (Hosting${c.cloudflare ? ", Cloudflare als Netzwerk- und Sicherheitsdienstleister" : ""}${c.mail ? ", E-Mail-Versand" : ""}), die als Auftragsverarbeiter weisungsgebunden tätig sind, sowie die oben genannten Videoanbieter nach Ihrem Klick.`);
  s.push(`## ${n++}. Ihre Rechte

Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch gegen Verarbeitungen auf Grundlage von Art. 6 Abs. 1 lit. f (Art. 21). Eine Einwilligung können Sie jederzeit mit Wirkung für die Zukunft widerrufen (Art. 7 Abs. 3).

Mit einem Konto können Sie Auskunft und Datenübertragbarkeit selbst nutzen („Meine Daten herunterladen“) und Ihr Konto selbst löschen. Für alles Weitere wenden Sie sich an den Verantwortlichen.

Sie haben außerdem das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren (Art. 77 DSGVO), insbesondere in dem Mitgliedstaat Ihres Aufenthaltsorts, Ihres Arbeitsplatzes oder des mutmaßlichen Verstoßes.`);
  s.push(`## ${n++}. Automatisierte Entscheidungen

Es findet keine automatisierte Entscheidungsfindung einschließlich Profiling im Sinne von Art. 22 DSGVO statt. Die zeitweise Sperre nach mehreren falschen Anmeldeversuchen ist eine Sicherheitsmaßnahme, die Sie oder ein Administrator jederzeit aufheben lassen können.

---

Stand: ${TEMPLATE_DATE.de}`);
  return s.join("\n\n");
}

function privacyEn(c: Ctx): string {
  const { cfg } = c;
  const s: string[] = [];
  s.push(`# Privacy notice

This notice explains, as required by Articles 13 and 14 of the General Data Protection Regulation (GDPR), which personal data this wiki (“${esc(cfg.site_name)}”) processes, why, on which legal basis and for how long.

## 1. Controller

${operatorBlock(c)}`);
  if (cfg.dpo_contact)
    s.push(`## 2. Data protection officer

${lines(cfg.dpo_contact)}`);
  s.push(`## ${cfg.dpo_contact ? 3 : 2}. In short

- No tracking, no analytics, no advertising, no social-media plugins.
${
  c.cloudflare
    ? "- All requests pass through Cloudflare’s network (see “Delivery via Cloudflare”). Fonts and all program files come from this server; beyond that, just reading sends no data to third parties."
    : "- Fonts and all program files are served from this server — just reading sends no data to third parties."
}
- Content from other providers (videos from YouTube or Vimeo${cfg.external_media_autoload ? "" : ", images from other servers"}) is only loaded after you explicitly click.
- With an account you can download your data and delete your account yourself at any time (“Your account” page).`);
  let n = cfg.dpo_contact ? 4 : 3;
  s.push(`## ${n++}. Visiting the pages

When you open a page, your browser necessarily transmits your IP address, date and time, the requested address and browser details (user agent). These are used only to deliver the page; the application itself keeps no access log. The legal basis is Art. 6(1)(f) GDPR (legitimate interest in secure operation). ${c.cloudflare ? "All requests reach the server via Cloudflare; see the next section." : "If the operator runs a web server or reverse proxy in front of the wiki, it may keep its own logs; ask the controller for details."}`);
  if (c.cloudflare)
    s.push(`## ${n++}. Delivery via Cloudflare

This wiki is delivered through the network of Cloudflare, Inc. (USA), for example via a Cloudflare Tunnel. Your browser does not connect to the operator’s server directly but to a Cloudflare data centre, which forwards the request to the server. This protects the server from attacks, and the server itself does not have to be reachable from the internet.

For every request, Cloudflare processes in particular your IP address, date and time, the requested address, browser details (user agent) and technical properties of the connection, in order to deliver the page and to detect and block attacks and automated access. Your browser’s encrypted HTTPS connection ends at Cloudflare, so Cloudflare can technically see the content of requests and responses — including input such as sign-in details. Cloudflare processes this data on the operator’s behalf (Art. 28 GDPR). How long Cloudflare keeps data is set out in Cloudflare’s privacy policy.

The legal basis is Art. 6(1)(f) GDPR; the legitimate interest is secure and available operation without the server being directly reachable from the internet. Cloudflare may transfer data to the USA and other countries. Cloudflare is certified under the EU-US Data Privacy Framework; transfers are based on the European Commission’s adequacy decision of 10 July 2023 (Art. 45 GDPR) and additionally on standard contractual clauses (Art. 46(2)(c) GDPR). More information: [Cloudflare privacy policy](https://www.cloudflare.com/privacypolicy/).`);
  s.push(`## ${n++}. Cookies and similar technologies

| Name | Purpose | Kept for |
|:-----|:--------|:---------|
| \`wiki_session\` | keeps you signed in | until you sign out, at most ${cfg.session_hours} hours |
| \`wiki_mfa\` | intermediate step of two-factor sign-in | 5 minutes |
| \`lang\`, \`theme\` | remembers language or light/dark design when you switch | 1 year |
| \`tidewiki:draft:…\` (local storage) | unsaved editor drafts, kept only in your browser | until saved or discarded |${
    c.cloudflare
      ? `
| \`__cf_bm\` | Cloudflare: tells people apart from automated access (bot protection) | 30 minutes after the last activity |
| \`cf_clearance\` | Cloudflare: proof that a security check was passed | set by Cloudflare |
| \`_cfuvid\` | Cloudflare: tells apart visitors sharing one IP address for rate limits | set by Cloudflare |`
      : ""
  }

All cookies and entries are strictly necessary for the service you request or only store a choice you made (§ 25(2) no. 2 TDDDG), so no consent is required.${c.cloudflare ? " Cloudflare only sets its cookies when the respective protection feature is active; they serve security purposes only." : ""} No cookies are used for advertising or analytics.`);
  s.push(`## ${n++}. User account

For an account we process username, e-mail address, role, your password (only as an Argon2id hash, never in plain text), with two-factor authentication, for each authenticator device, the name you gave it, the encrypted TOTP secret and when it was last used, plus hashed recovery codes, when the account was created and the password changed, and active sessions (time, browser${c.ipKnown ? ", IP address" : ""}).

The purpose is to provide the features for signed-in people (adding and editing pages). The legal basis is Art. 6(1)(b) GDPR (user agreement). These details are required for an account; without them you can only read the wiki. They are kept until you delete your account or it is deleted.`);
  s.push(`## ${n++}. Content and version history

Pages you create or edit are stored in the version history with your username and the time, so changes stay traceable (Art. 6(1)(f) GDPR). Uploaded images are stripped of metadata such as location (GPS), camera details and comments before they are stored; this isn't technically possible for videos — please only upload videos whose content and metadata you may share.

Deleted pages first go to a trash bin for 30 days, together with their version history, so an accidental deletion can be undone; only people who can edit see the trash. After that they are deleted for good.

When you delete your account, the content stays as part of the shared wiki; the link to you is removed (the author shows as “deleted account”). Please remove personal details you wrote into the text of a page yourself before deleting your account, or contact the controller.`);
  s.push(`## ${n++}. Backups

To protect against data loss, backup copies of the whole wiki — including accounts and the security log — are made (Art. 6(1)(f), Art. 32(1)(c) GDPR).${backupEn(cfg)} Backups are encrypted with AES-256 before they are stored and are accessible to the operator only. ${cfg.backup_target === "s3" ? `They are kept with an S3 storage service (${s3HostOf(cfg)}), which acts as a processor (Art. 28 GDPR) and only receives the encrypted data.` : "They are kept on storage of the operator."} They are used solely to restore the wiki, or single pages and accounts, after an error or data loss. Data deleted after a backup was made stays in that backup until the backup itself is deleted. If you deleted your account yourself, it is not brought back even when an older backup is restored.`);
  s.push(`## ${n++}. Security log

To protect against misuse we record security-relevant events (e.g. sign-ins, failed attempts, lock-outs, changes to accounts and settings) with time, the account concerned${c.ipKnown ? " and IP address" : ""}. The legal basis is Art. 6(1)(f) GDPR (protecting accounts and the system). ${c.ipKnown ? `IP addresses are removed after ${cfg.ip_retention_days} days, ` : ""}entries are deleted automatically after ${cfg.log_retention_days} days. Only administrators can view the log.`);
  if (c.mail)
    s.push(`## ${n++}. E-mails

If you request a new password, we send a link to your e-mail address using the operator’s e-mail service. If you change your e-mail address, we notify the previous address once so that an unauthorised change is noticed. Mail is sent via this service, which may act as a processor (Art. 28 GDPR). The legal basis is Art. 6(1)(b) GDPR. The link is valid for 30 minutes and then deleted.`);
  s.push(`## ${n++}. Embedded videos and external content

Videos from **YouTube** (Google Ireland Limited, Ireland; parent company Google LLC, USA) and **Vimeo** (Vimeo.com, Inc., USA) are not loaded automatically. Only when you click “Load video” does your browser connect to the provider, transmitting at least your IP address, browser details and the page you are on; the provider may use cookies or similar technologies. YouTube videos are embedded in privacy-enhanced mode (youtube-nocookie.com).

The legal basis is your consent given by clicking (Art. 6(1)(a) GDPR, § 25(1) TDDDG); it applies only to that video and is not stored. Data may be transferred to the USA. Where the provider is certified under the EU-US Data Privacy Framework, this is based on the European Commission’s adequacy decision of 10 July 2023 (Art. 45 GDPR), otherwise on your consent (Art. 49(1)(a) GDPR). Provider information: [Google](https://policies.google.com/privacy), [Vimeo](https://vimeo.com/privacy).

${
  cfg.external_media_autoload
    ? "Images and video files that authors embed from other servers are loaded directly from those servers, which then receive your IP address and browser details (Art. 6(1)(f) GDPR)."
    : "Images and video files from other servers are also only loaded after a click; only then does that server receive your IP address and browser details."
}
Links to videos on other platforms open the provider’s site, where its own privacy policy applies.`);
  s.push(`## ${n++}. Recipients

Your data is not sold and not passed on for advertising. Recipients can only be the operator’s technical service providers (hosting${c.cloudflare ? ", Cloudflare as network and security provider" : ""}${c.mail ? ", e-mail delivery" : ""}) acting as processors under instructions, and the video providers named above after your click.`);
  s.push(`## ${n++}. Your rights

You have the right of access (Art. 15 GDPR), rectification (Art. 16), erasure (Art. 17), restriction of processing (Art. 18), data portability (Art. 20) and to object to processing based on Art. 6(1)(f) (Art. 21). You can withdraw consent at any time with effect for the future (Art. 7(3)).

With an account you can use access and portability yourself (“Download my data”) and delete your account yourself. For anything else, contact the controller.

You also have the right to lodge a complaint with a data protection supervisory authority (Art. 77 GDPR), in particular in the member state of your residence, place of work or of the alleged infringement.`);
  s.push(`## ${n++}. Automated decisions

There is no automated decision-making, including profiling, within the meaning of Art. 22 GDPR. The temporary lock after several wrong sign-in attempts is a security measure that you or an administrator can have lifted at any time.

---

Last updated: ${TEMPLATE_DATE.en}`);
  return s.join("\n\n");
}

/* -------------------------------------------------------------------- terms */

const termsDe = (c: Ctx) => `# Nutzungsbedingungen

## 1. Geltungsbereich

Diese Bedingungen gelten für die Nutzung des Wikis „${esc(c.cfg.site_name)}“, betrieben von ${c.cfg.operator_name ? esc(c.cfg.operator_name) : "[Betreiber]"}${c.cfg.legal_imprint_enabled ? " (siehe [Impressum](/imprint))" : ""}. Lesen ist ${c.cfg.public_read ? "ohne Anmeldung möglich" : "nur mit einem Konto möglich"}; zum Anlegen und Bearbeiten von Seiten ist ein Konto nötig.

## 2. Konto

- Halten Sie Ihre Zugangsdaten geheim und nutzen Sie ein eigenes, sicheres Passwort. Ein Konto ist persönlich und darf nicht weitergegeben werden.
- Informieren Sie den Betreiber unverzüglich, wenn Sie einen Missbrauch Ihres Kontos vermuten.
- Sie können Ihr Konto jederzeit selbst löschen (Seite „Ihr Konto“).

## 3. Inhalte

- Sie sind für die Inhalte verantwortlich, die Sie einstellen. Verboten sind insbesondere rechtswidrige, beleidigende oder diskriminierende Inhalte sowie Inhalte, die Rechte Dritter verletzen (z. B. Urheber-, Marken- oder Persönlichkeitsrechte).
- Stellen Sie personenbezogene Daten anderer Personen (z. B. Namen, Fotos, Kontaktdaten) nur ein, wenn das erforderlich und zulässig ist.
- Laden Sie nur Bilder und Videos hoch, an denen Sie die nötigen Rechte haben, und auf denen erkennbare Personen nur mit deren Einverständnis zu sehen sind.
- Laden Sie keine Schadsoftware oder Dateien hoch, die andere gefährden können.

## 4. Nutzungsrechte

Ein Wiki lebt von gemeinsamer Arbeit. Mit dem Einstellen räumen Sie dem Betreiber und den anderen Nutzenden ein einfaches, unentgeltliches, zeitlich unbegrenztes Recht ein, Ihre Beiträge in diesem Wiki zu speichern, anzuzeigen, zu bearbeiten und weiterzuentwickeln. Dieses Recht bleibt bestehen, wenn Sie Ihr Konto löschen; Ihre Beiträge werden dann ohne Namensnennung weitergeführt.

## 5. Moderation

Der Betreiber darf Inhalte bearbeiten oder entfernen und Konten sperren oder löschen, wenn sie gegen diese Bedingungen oder geltendes Recht verstoßen oder der Betrieb es erfordert.

## 6. Verfügbarkeit

Das Wiki wird ohne Gewähr für ständige Verfügbarkeit, Vollständigkeit oder Richtigkeit der Inhalte bereitgestellt. Wartungen und Unterbrechungen sind möglich.

## 7. Haftung

Der Betreiber haftet unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei Verletzung von Leben, Körper oder Gesundheit sowie nach dem Produkthaftungsgesetz. Bei einfacher Fahrlässigkeit haftet er nur bei Verletzung einer wesentlichen Pflicht, deren Erfüllung die ordnungsgemäße Nutzung erst ermöglicht, und begrenzt auf den vorhersehbaren, typischen Schaden. Für Inhalte, die Nutzende einstellen, ist der Betreiber nach Maßgabe der gesetzlichen Vorschriften erst ab Kenntnis verantwortlich.

${privacySection(c, "## 8. Datenschutz\n\nWie Ihre Daten verarbeitet werden, steht in der [Datenschutzerklärung]", "## 8. Datenschutz\n\nWie Ihre Daten verarbeitet werden, erfahren Sie beim Betreiber.")}

## 9. Änderungen

Der Betreiber kann diese Bedingungen mit Wirkung für die Zukunft ändern, wenn ein sachlicher Grund besteht. Wesentliche Änderungen werden angekündigt.

## 10. Schlussbestimmungen

Es gilt das Recht der Bundesrepublik Deutschland. Zwingende Verbraucherschutzvorschriften des Staates, in dem Sie Ihren gewöhnlichen Aufenthalt haben, bleiben unberührt. Sollte eine Bestimmung unwirksam sein, bleiben die übrigen wirksam.

---

Stand: ${TEMPLATE_DATE.de}`;

const termsEn = (c: Ctx) => `# Terms of use

## 1. Scope

These terms apply to the use of the wiki “${esc(c.cfg.site_name)}”, operated by ${c.cfg.operator_name ? esc(c.cfg.operator_name) : "[operator]"}${c.cfg.legal_imprint_enabled ? " (see [imprint](/imprint))" : ""}. Reading is ${c.cfg.public_read ? "possible without signing in" : "only possible with an account"}; adding and editing pages requires an account.

## 2. Account

- Keep your credentials secret and use your own strong password. An account is personal and must not be shared.
- Tell the operator straight away if you suspect your account is being misused.
- You can delete your account yourself at any time (“Your account” page).

## 3. Content

- You are responsible for the content you post. In particular, content that is unlawful, insulting or discriminatory, or that infringes the rights of others (e.g. copyright, trademarks, personality rights), is not allowed.
- Only post personal data of other people (e.g. names, photos, contact details) where this is necessary and lawful.
- Only upload images and videos you have the rights to, and show identifiable people only with their consent.
- Don’t upload malware or files that could harm others.

## 4. Rights to contributions

A wiki lives from shared work. By posting, you grant the operator and the other users a simple, free, perpetual right to store, display, edit and develop your contributions within this wiki. This right continues if you delete your account; your contributions are then kept without attribution.

## 5. Moderation

The operator may edit or remove content and suspend or delete accounts that violate these terms or the law, or where operation requires it.

## 6. Availability

The wiki is provided without any guarantee of constant availability or of completeness or correctness of the content. Maintenance and interruptions may occur.

## 7. Liability

The operator is fully liable for intent and gross negligence, for injury to life, body or health and under the Product Liability Act. For simple negligence, the operator is only liable for breach of an essential obligation that makes proper use possible in the first place, limited to the foreseeable, typical damage. For content posted by users, the operator is responsible in accordance with the law only from the time it becomes aware of it.

${privacySection(c, "## 8. Privacy\n\nHow your data is processed is described in the [privacy notice]", "## 8. Privacy\n\nThe operator can tell you how your data is processed.")}

## 9. Changes

The operator may change these terms with effect for the future if there is a good reason. Significant changes will be announced.

## 10. Final provisions

German law applies. Mandatory consumer protection rules of the country where you usually live remain unaffected. If a provision is invalid, the rest remain valid.

---

Last updated: ${TEMPLATE_DATE.en}`;

/* ------------------------------------------------------------------ imprint */

const imprintDe = (c: Ctx) => `# Impressum

## Angaben gemäß § 5 DDG

${operatorBlock(c)}
${c.cfg.imprint_extra ? `\n${lines(c.cfg.imprint_extra)}\n` : ""}
${privacySection(c, "## Datenschutz\n\nInformationen zur Verarbeitung personenbezogener Daten finden Sie in der [Datenschutzerklärung]")}`;

const imprintEn = (c: Ctx) => `# Imprint

## Information pursuant to § 5 DDG (German Digital Services Act)

${operatorBlock(c)}
${c.cfg.imprint_extra ? `\n${lines(c.cfg.imprint_extra)}\n` : ""}
${privacySection(c, "## Privacy\n\nInformation on how personal data is processed is in the [privacy notice]")}`;

const TEMPLATES: Record<LegalKey, Record<Lang, (c: Ctx) => string>> = {
  privacy: { de: privacyDe, en: privacyEn },
  terms: { de: termsDe, en: termsEn },
  imprint: { de: imprintDe, en: imprintEn },
};

/** Cloudflare adds a CF-Ray header ("<16 hex>-<IATA>") to every request it forwards, tunnel or proxy. */
export const viaCloudflare = (h: Headers) => /^[0-9a-f]{16}-[A-Z]{3}$/i.test(h.get("cf-ray") ?? "");

/**
 * `cloudflare`: whether this request reached the wiki through Cloudflare. The privacy notice then
 * describes Cloudflare. A forged header only changes the reader's own view of the notice.
 */
const s3HostOf = (cfg: Settings) => {
  try {
    return new URL(cfg.backup_s3_endpoint).hostname;
  } catch {
    return "S3";
  }
};

/** One sentence on the automatic backup schedule and how long backups are kept. */
function backupDe(cfg: Settings): string {
  if (!cfg.backup_enabled) return "";
  const days = Math.max(1, Math.ceil((cfg.backup_keep * cfg.backup_interval_hours) / 24));
  return ` Automatische Sicherungen entstehen alle ${cfg.backup_interval_hours} Stunden; die jeweils neuesten ${cfg.backup_keep} werden aufbewahrt, ältere automatisch gelöscht (eine automatische Sicherung bleibt also etwa ${days} ${days === 1 ? "Tag" : "Tage"} erhalten).`;
}
function backupEn(cfg: Settings): string {
  if (!cfg.backup_enabled) return "";
  const days = Math.max(1, Math.ceil((cfg.backup_keep * cfg.backup_interval_hours) / 24));
  return ` Automatic backups are made every ${cfg.backup_interval_hours} hours; the newest ${cfg.backup_keep} are kept and older ones deleted automatically (so an automatic backup is kept for about ${days} ${days === 1 ? "day" : "days"}).`;
}

export async function generateLegal(key: LegalKey, lang: Lang, opts: { cloudflare?: boolean } = {}): Promise<string> {
  return TEMPLATES[key][lang]({
    cfg: await getSettings(),
    lang,
    mail: await isMailConfigured(),
    ipKnown: TRUSTED_PROXY_HOPS > 0,
    cloudflare: !!opts.cloudflare,
  });
}

/** Operator fields the generated pages rely on that are still empty. */
export async function missingOperatorFields(): Promise<string[]> {
  const c = await getSettings();
  const needed = c.legal_imprint_enabled
    ? (["operator_name", "operator_address", "operator_email"] as const)
    : (["operator_name", "operator_email"] as const);
  return needed.filter((k) => !c[k]);
}

export async function getLegal(
  key: LegalKey,
  lang: Lang,
  opts: { cloudflare?: boolean } = {},
): Promise<{ content: string; custom: boolean; updatedAt: number | null }> {
  const row = await one<{ content: string; updated_at: number }>(
    sql`SELECT content, updated_at FROM legal_pages WHERE key = ${key} AND lang = ${lang}`,
  );
  return row
    ? { content: row.content, custom: true, updatedAt: row.updated_at }
    : { content: await generateLegal(key, lang, opts), custom: false, updatedAt: null };
}

export async function setLegal(key: LegalKey, lang: Lang, content: string, userId: number) {
  if (!content.trim()) throw new HttpError(400, "The text can’t be empty.", "content");
  await run(
    sql`INSERT INTO legal_pages(key, lang, content, updated_by, updated_at)
        VALUES (${key}, ${lang}, ${content}, ${userId}, ${now()})
        ON CONFLICT (key, lang) DO UPDATE SET content = excluded.content, updated_by = excluded.updated_by,
          updated_at = excluded.updated_at`,
  );
}

export const resetLegal = async (key: LegalKey, lang: Lang) =>
  (await run(sql`DELETE FROM legal_pages WHERE key = ${key} AND lang = ${lang}`)) > 0;
