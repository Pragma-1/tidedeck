import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { LoginForm } from "@/components/auth-forms";
import { gate } from "@/lib/guard";
import { getSettings } from "@/lib/settings";
import { getT } from "@/lib/i18n-server";
import { Notice } from "@/components/ui";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: (await getT())("Sign in") };
}

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; restored?: string; missing?: string }>;
}) {
  const user = await gate("none", { allowPending2fa: true });
  if (user) redirect("/");
  const cfg = await getSettings();
  const sp = await searchParams;
  const t = await getT();
  const missing = sp.missing && /^\d{1,6}$/.test(sp.missing) ? Number(sp.missing) : 0;
  return (
    <Shell live={false}>
      {sp.restored === "1" && (
        <div style={{ maxWidth: "28rem", margin: "0 auto" }}>
          <Notice>
            {t("The backup was restored and everyone was signed out. Sign in with the password from that time.")}
            {missing > 0 && ` ${t("{n} files were missing from the backup folder.", { n: missing })}`}
          </Notice>
        </div>
      )}
      <LoginForm next={sp.next} canRegister={cfg.allow_registration} canReset={cfg.allow_password_reset} />
    </Shell>
  );
}
