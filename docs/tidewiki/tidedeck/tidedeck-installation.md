---
title: "Installation"
---

Tidedeck is one container with one data folder. You need Docker with the Compose plugin (or Arcane, Portainer, Dockge … — anything that runs a compose file).

## Files

Put both files into an empty folder, e.g. `/opt/stacks/tidedeck`.

**`docker-compose.yml`**

```yaml
services:
  tidedeck:
    image: astaldoo/tidedeck:latest
    container_name: tidedeck
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    cap_drop: [ALL]
    cap_add: [CHOWN, DAC_OVERRIDE, FOWNER, SETUID, SETGID]
    read_only: true
    tmpfs:
      - /tmp
    ports:
      - "${PORT:?Set PORT in .env}:3000"
    environment:
      PUID: ${PUID:-1000}
      PGID: ${PGID:-1000}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:-}
      AUTH_DISABLED: ${AUTH_DISABLED:-}
    volumes:
      - ./data:/app/data
```

**`.env`**

```bash
# The port you open in the browser: http://<host>:<PORT>
PORT=3004
# The user Tidedeck runs as and who owns ./data (id -u / id -g on the host)
PUID=1000
PGID=1000
# Optional: the admin password, instead of the setup code (only read on the very first start)
ADMIN_PASSWORD=
```

::: info Why the port appears only once
`PORT` is the **host** port. Inside the container Tidedeck always listens on `3000`, so the compose file maps `${PORT}:3000` and there is nothing else to change.
:::

## Start

```bash
docker compose up -d
docker logs tidedeck
```

The log shows a line like:

```text
[tidedeck] No admin password set yet. Setup code: K7QM-2XRP
```

Open `http://<host>:<PORT>`, click **Edit**, enter the setup code and choose a password (at least 8 characters). The code works once. If you set `ADMIN_PASSWORD` before the first start, there is no setup code and that password is used.

**With Arcane:** create a new project, paste the compose file, add the variables from `.env` in the project's environment, deploy. The setup code is in the container's log view.

## Who can see what

- **Everyone who can open the page** sees the dashboard — including app addresses and notes.
- **Only you** (signed in) can change it.
- **Settings → General → Require sign-in to view** makes it private: visitors only see a sign-in card.

::: warning Reachable from the internet?
Then turn on **Require sign-in to view**, or put Tidedeck behind your proxy's login. Publish it only through the proxy or tunnel and keep the port itself on the LAN — see [[tidedeck-security|Sign-in and security]].
:::

## Reverse proxy and Cloudflare Tunnel

Point the proxy or tunnel at `http://<host>:<PORT>`. Nothing has to be configured inside Tidedeck: it reads `CF-Connecting-IP`, `X-Real-IP` and `X-Forwarded-For` for the sign-in lock-out and sets the cookie `Secure` when the request came over HTTPS. Live sync uses Server-Sent Events, which work through Cloudflare and common proxies without extra settings.

## Environment

| Variable | Default | |
| --- | --- | --- |
| `PORT` | – | Host port. Required |
| `PUID` / `PGID` | `1000` | User the server runs as and owner of `./data`. `0` (root) is refused |
| `ADMIN_PASSWORD` | – | Password on first start instead of the setup code |
| `AUTH_DISABLED` | – | `true` lets everyone edit — only behind a proxy that does the sign-in |
| `DATA_DIR` | `/app/data` | Data folder inside the container |

## What the hardening lines do

| Line | Effect |
| --- | --- |
| `no-new-privileges` | No process in the container can gain rights later |
| `cap_drop` / `cap_add` | Only the five capabilities the start script needs to hand `./data` to `PUID:PGID` and switch to that user; the server itself then runs without any |
| `read_only` + `tmpfs /tmp` | The program files can't be changed; only `./data` and `/tmp` are writable |

If your Docker host doesn't support one of them (rare, e.g. some NAS systems), remove that line — Tidedeck runs without it too.

## Without Docker

Node.js 22 (24 works too):

```bash
npm ci && npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
DATA_DIR=./data PORT=3000 node .next/standalone/server.js
```

Next: [[tidedeck-layout|Editing the board]].
