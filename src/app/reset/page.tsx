import { Shell } from "@/components/shell";
import { ResetForm } from "@/components/auth-forms";
import { gate } from "@/lib/guard";
import { getSettings } from "@/lib/settings";
import { getT } from "@/lib/i18n-server";
import { policyFromSettings } from "@/lib/password-policy";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: (await getT())("Choose a new password") };
}

export default async function Reset() {
  await gate("none");
  return (
    <Shell live={false}>
      <ResetForm policy={policyFromSettings(await getSettings())} />
    </Shell>
  );
}
