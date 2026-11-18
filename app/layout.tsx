import type { Metadata, Viewport } from "next"
import { headers } from "next/headers"
import "@fontsource-variable/inter/opsz.css"
import "@fontsource-variable/inter/opsz-italic.css"
import "@fontsource-variable/jetbrains-mono"
// Selectable fonts. Only the one in use is downloaded by the browser.
import "@fontsource-variable/ibm-plex-sans"
import "@fontsource-variable/manrope"
import "@fontsource-variable/space-grotesk"
import "@fontsource-variable/nunito"
import "@fontsource-variable/atkinson-hyperlegible-next"
import "@fontsource-variable/source-serif-4"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { DEVICE_SCRIPT } from "@/lib/display"
import { LOCALE_SCRIPT } from "@/lib/locale-context"
import { themeCss } from "@/lib/theme"
import { getConfig } from "@/lib/server/store"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const { config } = await getConfig()
  const title = config.settings.title || "Tidedeck"
  return {
    title,
    description: "Your self-hosted start page",
    icons: { apple: "/apple-touch-icon.png" },
    appleWebApp: { capable: true, title, statusBarStyle: "black-translucent" },
  }
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
    { media: "(prefers-color-scheme: light)", color: "#2a2f36" },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [{ config }, h] = await Promise.all([getConfig(), headers()])
  const nonce = h.get("x-nonce") ?? undefined
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* The "Look" settings; the dashboard replaces this live when they change. Values are validated by the schema. */}
        <style id="td-theme" dangerouslySetInnerHTML={{ __html: themeCss(config.settings) }} />
        {/* A size set for this device only (Look → Size) is applied before the first paint. */}
        {/* …and the browser's locale and time zone are noted for the next visit (see lib/locale-context.ts). */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: DEVICE_SCRIPT + LOCALE_SCRIPT }} />
        <ThemeProvider attribute="data-theme" defaultTheme={config.settings.theme} enableSystem disableTransitionOnChange nonce={nonce}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
