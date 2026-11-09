import type { Metadata, Viewport } from "next"
import "@fontsource-variable/instrument-sans"
import "@fontsource-variable/bricolage-grotesque"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { accentVars } from "@/lib/accent"
import { getConfig } from "@/lib/server/store"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const { config } = await getConfig()
  return { title: config.settings.title || "Tidedeck", description: "Your self-hosted start page" }
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#22252a" },
    { media: "(prefers-color-scheme: light)", color: "#e4e6e9" },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { config } = await getConfig()
  return (
    <html lang="en" suppressHydrationWarning style={accentVars(config.settings.accent) as React.CSSProperties}>
      <body>
        <ThemeProvider attribute="class" defaultTheme={config.settings.theme} enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
