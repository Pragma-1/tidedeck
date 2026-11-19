import { Shell } from "@/components/shell";
import { ForgotForm } from "@/components/auth-forms";
import { gate } from "@/lib/guard";
import { isMailConfigured } from "@/lib/mail";
import { getSettings } from "@/lib/settings";
import { getT } from "@/lib/i18n-server";
import Link from "next/link";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: (await getT())("Reset your password") };
}

export default async function Forgot() {
  await gate("none");
  const t = await getT();
  if (!(await getSettings()).allow_password_reset || !(await isMailConfigured()))
    return (
      <Shell live={false}>
        <div className="auth card">
          <h1>{t("Reset by e-mail isn’t available")}</h1>
          <p className="lead">
            {t(
              "This wiki can’t send e-mail right now. Ask an administrator — they can set a new password for you in Settings.",
            )}
          </p>
          <Link className="btn block" href="/login">
            {t("Back to sign in")}
          </Link>
        </div>
      </Shell>
    );
  return (
    <Shell live={false}>
      <ForgotForm />
    </Shell>
  );
}
