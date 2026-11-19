import { api, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { isMailConfigured, mailErrorReason, mailSource, sendMail } from "@/lib/mail";
import { renderMail } from "@/lib/mail-template";
import { consume } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { BASE_URL } from "@/lib/config";
import { formatDate } from "@/lib/i18n";
import { HttpError } from "@/lib/validate";
export const dynamic = "force-dynamic";

/**
 * Sends a test e-mail with the saved settings — always to the signed-in administrator's own
 * address, so the button can't be used to send mail to arbitrary recipients.
 */
export const POST = api("admin", async ({ user, ip, t, lang }) => {
  if (!(await consume(`mailtest:${user!.id}`, 5, 600)))
    throw new HttpError(429, "Too many test e-mails. Try again in a few minutes.");
  if (!(await isMailConfigured())) throw new HttpError(400, "E-mail is not configured.");
  const site = (await getSettings()).site_name;
  const mail = renderMail({
    site,
    heading: t("Your e-mail settings work"),
    preheader: t("This is a test message from {site}.", { site }),
    paragraphs: [
      t("Hello {name},", { name: user!.username }),
      t(
        "this is a test message from {site}. If you can read it, password reset links and notifications will arrive as well.",
        { site },
      ),
    ],
    facts: [
      [t("Sent at"), formatDate(Math.floor(Date.now() / 1000), lang, true)],
      [t("Configuration"), (await mailSource()) === "settings" ? t("Settings → E-mail") : t("Environment (.env)")],
      [t("Wiki address"), BASE_URL],
    ],
    button: { label: t("Open {site}", { site }), url: BASE_URL },
    footer: t("You receive this e-mail because an administrator pressed “Send test e-mail” in the settings."),
  });
  try {
    await sendMail(user!.email, t("{site}: test e-mail", { site }), mail.text, mail.html);
  } catch (e) {
    const reason = mailErrorReason(e);
    await audit("admin.mail_test", user!.id, ip, `failed: ${reason}`.slice(0, 300));
    throw new HttpError(502, t("Sending failed: {reason}", { reason: t(reason) }));
  }
  await audit("admin.mail_test", user!.id, ip, "ok");
  return json({ ok: true, to: user!.email });
});
