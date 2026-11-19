import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/inter/opsz-italic.css";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { getSettings } from "@/lib/settings";
import { getLang } from "@/lib/i18n-server";
import { serverTimeZone, translate } from "@/lib/i18n";
import { LangProvider } from "@/components/i18n";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2a2f36" },
    { media: "(prefers-color-scheme: dark)", color: "#121418" },
  ],
};
export async function generateMetadata(): Promise<Metadata> {
  const name = (await getSettings()).site_name;
  return {
    title: { default: name, template: `%s · ${name}` },
    description: translate(await getLang(), "A self-hosted wiki."),
    robots: { index: false },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("theme")?.value;
  const lang = await getLang();
  return (
    <html lang={lang} data-theme={theme === "dark" || theme === "light" ? theme : undefined}>
      <body>
        <LangProvider lang={lang} tz={serverTimeZone()}>
          {children}
        </LangProvider>
      </body>
    </html>
  );
}
