import { configSchema, type DashboardConfig } from "@/lib/schema"

/** First-run dashboard. Replaced the moment you edit anything. */
export function defaultConfig(): DashboardConfig {
  return configSchema.parse({
    version: 1,
    settings: {},
    boards: [
      {
        id: "home",
        name: "Home",
        blocks: [
          { id: "search", type: "search", title: "", showTitle: false, props: {} },
          { id: "clock", type: "clock", title: "", showTitle: false, props: {} },
          { id: "weather", type: "weather", title: "Weather", props: {} },
          {
            id: "infra",
            type: "apps",
            title: "Infrastructure",
            props: {
              apps: [
                { id: "proxmox", name: "Proxmox", url: "https://proxmox.local:8006", icon: "proxmox", description: "Hypervisor" },
                { id: "truenas", name: "TrueNAS", url: "https://truenas.local", icon: "truenas-scale", description: "Storage" },
                { id: "portainer", name: "Portainer", url: "https://portainer.local", icon: "portainer", description: "Containers" },
              ],
            },
          },
          {
            id: "media",
            type: "apps",
            title: "Media",
            props: {
              apps: [
                { id: "jellyfin", name: "Jellyfin", url: "http://jellyfin.local:8096", icon: "jellyfin", description: "Streaming" },
                { id: "sonarr", name: "Sonarr", url: "http://sonarr.local:8989", icon: "sonarr", description: "Series" },
                { id: "radarr", name: "Radarr", url: "http://radarr.local:7878", icon: "radarr", description: "Movies" },
              ],
            },
          },
          { id: "system", type: "system", title: "This server", props: {} },
          {
            id: "notes",
            type: "notes",
            title: "Notes",
            props: {
              content:
                "Click **Edit** in the top right to change this dashboard.\n\n- Drag blocks to move them\n- Pull the corner to resize\n- Use **Add block** for apps, widgets and links",
            },
          },
        ],
        layouts: {
          lg: [
            { i: "search", x: 0, y: 0, w: 8, h: 2 },
            { i: "clock", x: 8, y: 0, w: 4, h: 2 },
            { i: "infra", x: 0, y: 2, w: 4, h: 5 },
            { i: "media", x: 4, y: 2, w: 4, h: 5 },
            { i: "weather", x: 8, y: 2, w: 4, h: 5 },
            { i: "system", x: 0, y: 7, w: 4, h: 5 },
            { i: "notes", x: 4, y: 7, w: 4, h: 5 },
          ],
        },
      },
    ],
  })
}
