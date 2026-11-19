import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { RegisterForm } from "@/components/auth-forms";
import { gate } from "@/lib/guard";
import { getSettings, privacyHref } from "@/lib/settings";
import { getT } from "@/lib/i18n-server";
import { policyFromSettings } from "@/lib/password-policy";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: (await getT())("Create an account") };
}

export default async function Register() {
  const user = await gate("none");
  if (user) redirect("/");
  const cfg = await getSettings();
  const t = await getT();
  if (!cfg.allow_registration)
    return (
      <Shell live={false}>
        <div className="auth card">
          <h1>{t("Registration is closed")}</h1>
          <p className="lead">{t("An administrator has turned off self-registration. Ask them for an account.")}</p>
        </div>
      </Shell>
    );
  return (
    <Shell live={false}>
      <RegisterForm
        policy={policyFromSettings(cfg)}
        termsEnabled={cfg.legal_terms_enabled}
        privacyHref={privacyHref(cfg)}
      />
    </Shell>
  );
}
