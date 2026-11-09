# Tidedeck

A self-hosted start page you set up entirely in the browser. You don't write YAML and you don't restart anything. Click **Edit**, then drag, resize, add and remove blocks. Every change saves itself and shows up right away in every other open tab.

## Run it

```bash
cp .env.example .env        # set PORT, PUID, PGID
docker compose up -d --build
```

Open `http://<host>:3000` and click **Edit**. On the first click you choose the admin password. After that, anyone can view the dashboard but only you can change it. To let only signed-in people see it, turn that on under Settings → General.

Without Docker:

```bash
npm ci
npm run build
DATA_DIR=./data node .next/standalone/server.js   # copy .next/static and public into .next/standalone first, as the Dockerfile does
```

For development use `npm run dev`.

## What's included

| Block | What it does |
|---|---|
| App | One service as a tile, with an online/offline dot and response time |
| App group | Several services under a heading, shown as tiles or a list. Order: custom (drag the tiles in edit mode), A to Z, Z to A, or random on every page load |
| Bookmarks | A compact list of links (an app group with status checks off) |
| Search | Filters your apps while you type, or searches DuckDuckGo, Google, Bing, Startpage, Brave or your own SearXNG. Press `/` to focus it |
| Clock | Time and date in any time zone, 12/24 h |
| Calendar | A month view you can page through |
| Weather | Open-Meteo, so no API key is needed. Find the place by name |
| Server resources | CPU, memory, disk and uptime of the host |
| RSS feed | Merges several RSS/Atom feeds |
| Notes | Markdown with GFM: tables, checklists and links |
| Embedded page | Shows any page in an iframe (if the site allows embedding) |

Across the dashboard:

- **Boards**: several dashboards shown as tabs. You can add, rename, reorder and delete them.
- **Moving and resizing**: in edit mode, drag a block anywhere and pull any corner or edge to resize it.
- **Grid**: separate layouts for desktop, tablet and phone widths. On a narrow screen, a layout is generated from the wider one until you arrange it yourself.
- **Look**: dark, light or follow-device theme; accent colour; a background image with blur and darken; see-through blocks; custom CSS.
- **Icons**: every app has an icon picker. You can:
  - search [selfh.st/icons](https://selfh.st/icons/) (CC BY 4.0) or [dashboard-icons](https://github.com/homarr-labs/dashboard-icons), and pick the standard, light or dark variant
  - upload your own image
  - paste any image link
  - leave it empty to use the site's favicon

  You can also type a value directly: `sh:immich`, `sh:immich-light`, `di:proxmox`, or a URL.
- **Status checks**: the server checks each service, so it also works for internal hosts and self-signed HTTPS. Login pages (401/403) count as online. You can check a different address than the one the tile links to.
- **Backups**: export and import from the browser. The server also keeps the last 20 versions in `data/backups`.
- **Shortcuts**: `/` search, `e` edit mode, `Esc` leave edit mode.

## Music

**Navidrome / Subsonic** is a full player inside the dashboard. You can browse recent, new and random albums and your playlists, search, play, shuffle and repeat, use the queue and seek. The media keys on your keyboard and phone lock screen work, and plays are scrobbled to Navidrome. Playback keeps going when you switch boards or enter edit mode, and a small player shows up in the header whenever the music block isn't on screen. Audio and covers stream through Tidedeck, so the block also works when Navidrome is only reachable inside your network. You can lower the bitrate for listening on mobile data. Sign in with a username and password or an OpenSubsonic API key. The login is stored encrypted on the server and never sent to the browser. By default only you can play; set **Let visitors play music** to change that.

**Spotify, YouTube / YouTube Music, Deezer**: paste a share link and the block shows that service's official player. These are the services' own limits:
- Spotify plays full songs only when you're signed in to spotify.com in the same browser. Otherwise it plays 30-second previews.
- Deezer's embedded player only plays 30-second previews of songs. Podcasts play in full.
- YouTube Music's own site can't be embedded, so playlists play in the regular YouTube player (privacy-enhanced youtube-nocookie.com).

## Data

Everything lives in `./data`:

- `dashboard.json`: boards, blocks and settings. You never have to touch it.
- `auth.json`: scrypt password hash and the session signing key (mode 600).
- `secrets.json`: logins for connected services such as Navidrome, encrypted with AES-256-GCM using a key derived from `auth.json` (mode 600). It isn't included in exports or backups.
- `backups/`: automatic snapshots.
- `icons/`: icons you uploaded. File names are content hashes. Each file's bytes are checked to make sure it's really an image, and SVGs are served with a sandboxing Content-Security-Policy so they can't run scripts.

## Security notes

- Passwords are hashed with scrypt (N=2^15). Sessions are HMAC-signed cookies (HttpOnly, SameSite=Lax, Secure when the request came over HTTPS). Changing the password signs out every other session.
- After 5 wrong passwords, logins from that address are locked out for 30 s. The lockout doubles with each further failure, up to 15 min. Behind Cloudflare, the real client IP is read from `CF-Connecting-IP`.
- Requests that change data must be JSON and come from the same origin.
- The server only runs status checks and fetches feeds for URLs that are saved in the dashboard. It can't be used as an open proxy.
- `javascript:`, `data:` and `vbscript:` links are rejected, both in the editor and on the server.
- Custom CSS and embedded pages can only be set by the admin.

## Environment

| Variable | Default | |
|---|---|---|
| `PORT` | `3000` | Host port. Inside the container the app always listens on 3000 |
| `PUID` / `PGID` | `1000` | Owner of `./data` |
| `DATA_DIR` | `/app/data` | Where the data files live |
| `ADMIN_PASSWORD` | – | Sets the password on first start; ignored once a password exists |
| `AUTH_DISABLED` | – | `true` lets everyone edit. Only use this behind a proxy that handles auth |
