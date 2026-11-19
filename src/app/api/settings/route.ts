import { api, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getSettings, settingsForClient, updateSettings } from "@/lib/settings";
import { HttpError } from "@/lib/validate";
import { syncSystemPages } from "@/lib/seed";
import { canSetMfaFor, MFA_SETTING, ROLES } from "@/lib/roles";
import { hasSmtpPassword, mailSource, setSmtpPassword, SMTP_PORTS, validSmtpHost } from "@/lib/mail";
export const dynamic = "force-dynamic";

const view = async (isOwner: boolean) => ({
  ...settingsForClient(await getSettings(), isOwner),
  smtp_password_set: await hasSmtpPassword(),
  mail_source: await mailSource(),
});

export const GET = api("admin", async ({ user }) => json(await view(user!.isOwner)));

export const PUT = api("admin", async ({ body, user, ip }) => {
  const b = { ...(await body()) };

  // Two-factor per role: only for roles below your own; the owner may change every role.
  for (const role of ROLES) {
    if (Object.prototype.hasOwnProperty.call(b, MFA_SETTING[role]) && !canSetMfaFor(user!, role))
      throw new HttpError(403, "You can only change this for roles below your own.");
  }

  // Backups: switching them off or keeping fewer can delete backups — the owner decides that.
  if (Object.keys(b).some((k) => k.startsWith("backup_")) && !user!.isOwner)
    throw new HttpError(403, "Only the owner can change this.");
  // Where backups go is changed only through /api/backups/target (password + connection test).
  if (Object.keys(b).some((k) => k === "backup_target" || k === "backup_local_dir" || k.startsWith("backup_s3_")))
    throw new HttpError(400, "Change the backup storage in the backup settings.");

  // The SMTP password is write-only and stored encrypted, outside the regular settings.
  let pw: string | null | undefined;
  if (Object.prototype.hasOwnProperty.call(b, "smtp_password")) {
    const v = b.smtp_password;
    delete b.smtp_password;
    if (v !== null && (typeof v !== "string" || v.length > 512 || /[\u0000-\u001f\u007f]/.test(v)))
      throw new HttpError(400, "Invalid value for smtp_password.");
    pw = v as string | null;
  }
  if (typeof b.smtp_host === "string" && b.smtp_host.trim() && !validSmtpHost(b.smtp_host.trim()))
    throw new HttpError(400, "Enter a valid host name for the mail server.");
  if (b.smtp_port !== undefined && !(SMTP_PORTS as readonly unknown[]).includes(b.smtp_port))
    throw new HttpError(400, "This port is not allowed for SMTP.");

  const keys = Object.keys(b);
  if (keys.length) {
    const r = await updateSettings(b);
    if (!r.ok) throw new HttpError(400, r.error);
  } else if (pw === undefined) throw new HttpError(400, "No settings supplied.");
  if (pw !== undefined) await setSmtpPassword(pw);

  const detail = [
    ...Object.entries(b).map(([k, v]) => `${k}=${JSON.stringify(v)}`),
    ...(pw !== undefined ? [pw ? "smtp_password=(set)" : "smtp_password=(removed)"] : []),
  ];
  await audit("admin.settings_changed", user!.id, ip, detail.join(", ").slice(0, 1000));
  if (typeof b.language === "string") await syncSystemPages((await getSettings()).language);
  return json(await view(user!.isOwner));
});
