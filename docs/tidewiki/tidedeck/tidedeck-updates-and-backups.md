---
title: "Updates, backups and moving"
---

## Updating

```bash
docker compose pull
docker compose up -d
```

In Arcane: **Pull** and **Redeploy** the project.

`latest` follows every published change. To update only when you decide to, use a version tag instead, e.g. `astaldoo/tidedeck:1.2` (that minor version) or `astaldoo/tidedeck:1.2.0` (exactly that one). The tags are listed on [Docker Hub](https://hub.docker.com/r/astaldoo/tidedeck/tags). Boards, settings and layouts of older versions are converted on start; nothing has to be done by hand. Read the [changelog](https://github.com/Pragma-1/tidedeck/blob/main/CHANGELOG.md) before larger jumps.

Tabs that are open during an update load the new version by themselves at the next quiet moment — not while you edit, type, have a dialog open or play music. A tab that is in the middle of editing reloads straight back into edit mode.

## What's in `./data`

| | |
| --- | --- |
| `dashboard.json` | boards, blocks and settings |
| `backups/` | the last 20 versions, one every five minutes while you edit |
| `auth.json` | password hash and session key |
| `secrets.json` | music logins and weather keys, encrypted with a key that belongs to `auth.json` |
| `icons/` | uploaded icons |

Back up the whole folder with the rest of your Docker data — it's small. `auth.json` and `secrets.json` belong together.

## Export and restore

**Settings → Backup:**

- **Export backup** downloads boards, blocks and settings as one `.json` file (no passwords, no music logins).
- **Restore from file** replaces the dashboard with a file like that. **Undo** appears right after, in case it was the wrong file.

To go back to an automatic snapshot: download the file from `data/backups/` and use **Restore from file**, or copy it over `data/dashboard.json` while the container is stopped.

## Moving to another machine

Stop the container, copy the `data` folder, the compose file and `.env`, start it on the new machine. Everything — password, sessions, music logins — comes along.

## Coming from another dashboard

**Settings → Backup → Import from another dashboard** reads:

| From | File |
| --- | --- |
| Homepage | `services.yaml` or `bookmarks.yaml` |
| Dashy | `conf.yml` (sections, also from several pages) |
| Homer | `config.yml` |

Choose the file or paste its content. Tidedeck shows what it found (e.g. _Homepage: 6 groups, 41 links_) and adds it as a **new board** with one app group per group; your current boards stay untouched.

Taken over: names, links, descriptions, how links open, and icons from dashboard-icons (`proxmox.png`, `hl-proxmox`) and selfh.st (`sh-proxmox`). Other icons become the site's favicon; links that aren't real links are skipped. Status dots start switched off — turn them on per group. Service widgets and API integrations of those dashboards have no counterpart.

::: tip Tidy up after importing
Merge small groups, set **Compact** layout for bookmark-like groups, and move the board tab with the arrows in its menu.
:::

## Starting over

Stop the container and delete `data/dashboard.json` (keep `auth.json` to keep the password). The next start creates the welcome board.
