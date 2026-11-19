import { LegalPage } from "@/components/legal-page";
import { getLang } from "@/lib/i18n-server";
import { LEGAL_TITLES } from "@/lib/legal";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return { title: LEGAL_TITLES.privacy[await getLang()] };
}
export default function Page() {
  return <LegalPage k="privacy" />;
}
