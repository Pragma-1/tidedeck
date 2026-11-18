---
title: "Tidedeck"
---

**Tidedeck** is the start page of the Tide family: a self-hosted dashboard for every service in the homelab, built and changed right in the browser. No YAML, no restarts — click **Edit**, drag blocks around, and every change is saved and shows up live in every open tab.

![Tidedeck with app groups, search, clock, weather, server resources, music, releases, bookmarks, a checklist and a calendar](/media/tidedeck-board-dark.webp)

## At a glance

| | |
| --- | --- |
| Image | `astaldoo/tidedeck:latest` (Docker Hub) |
| Source | [github.com/Pragma-1/tidedeck](https://github.com/Pragma-1/tidedeck) |
| Port in the container | `3000` — the host port is `PORT` in `.env` |
| Data | `./data` next to the compose file; no database |
| Sign-in | One admin password; visitors can look, only the admin can change things |
| Shares with Tidewiki | Typeface, colours, header band, light/dark switch |

## What it can do

- **Blocks** for apps and app groups with online dots, search, clock with world times, calendar, weather, server resources, RSS, notes, a checklist, music (Navidrome, Spotify, YouTube, Deezer) and embedded pages.
- **Edit in place:** move, resize from any corner, duplicate, remove (with undo), copy or move blocks and apps to other boards. The board grows in every direction; desktop, tablet and phone each keep their own layout.
- **Quick launch** with `Ctrl+K`: every app on every board, typed addresses, search shortcuts such as `!yt` and web search.
- **Fits any screen:** scales up automatically on big displays, each block can zoom its content, and a wall-screen mode hides everything but the board.
- **Looks:** nine presets plus accent colour, font, background and more.
- **Moving in is easy:** imports Homepage, Dashy and Homer configurations.

## Chapters

1. [[tidedeck-installation|Installation]] — compose file, `.env`, first sign-in, reverse proxy
2. [[tidedeck-layout|Editing the board]] — edit mode, boards, grid, layouts per screen size
3. [[tidedeck-modules|Blocks]] — every block and its options
4. [[tidedeck-music|Music]] — Navidrome player and embeds
5. [[tidedeck-search|Search and quick launch]] — search shortcuts, ways to open apps
6. [[tidedeck-security|Sign-in and security]] — password, private mode, what visitors see
7. [[tidedeck-themes|Look, size and wall screens]] — presets, scaling, module zoom, kiosk
8. [[tidedeck-troubleshooting|Troubleshooting]] — when something doesn't work
9. [[tidedeck-updates-and-backups|Updates, backups and moving]] — updating, restoring, importing

::: tip Shortest way in
Install it (chapter 1), click **Edit**, then **Add block → App group**. Everything else can be discovered from there — double-click any block in edit mode for its settings.
:::
