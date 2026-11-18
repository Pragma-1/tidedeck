import type { MetadataRoute } from "next"
import { getConfig } from "@/lib/server/store"

export const dynamic = "force-dynamic"

/** Lets phones and desktops install Tidedeck as an app (own window, home-screen icon). */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let name = "Tidedeck"
  try {
    const { config } = await getConfig()
    name = config.settings.requireLoginToView ? "Tidedeck" : config.settings.title || "Tidedeck"
  } catch {}
  return {
    name,
    short_name: name.slice(0, 12),
    description: "Self-hosted dashboard",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#22262c",
    theme_color: "#2a2f36",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
