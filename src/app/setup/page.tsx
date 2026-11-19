import { redirect } from "next/navigation";
import { SetupForm } from "@/components/auth-forms";
import { Shell } from "@/components/shell";
import { userCount } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import { getSettings } from "@/lib/settings";
import { policyFromSettings } from "@/lib/password-policy";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: (await getT())("Set up your wiki") };
}

export default async function Setup() {
  if ((await userCount()) > 0) redirect("/"); // setup page disappears once an administrator exists
  return (
    <Shell live={false}>
      <SetupForm policy={policyFromSettings(await getSettings())} />
    </Shell>
  );
}
