---
title: "Search and quick launch"
---

![Quick launch with apps matching “na” and a web search](/media/tidedeck-quick-launch.webp)

## Quick launch

`Ctrl+K` (`⌘K` on a Mac), the **magnifier** in the header, or `/` on a board without a search block opens one box for everything:

| Type | Get |
| --- | --- |
| part of a name, description or address | the matching apps from **every** board (the board is shown on the right) |
| `nas.lan:5000`, `10.0.2.5:8006`, `https://…` | **Open** that address — LAN names and private IPs as `http://`, everything else as `https://` |
| `!yt lofi` | a search shortcut (see below) |
| anything else | a web search |

| Key | |
| --- | --- |
| `↑` `↓` | choose |
| `Enter` | open the way the app is set to open |
| `Ctrl+Enter` | new tab |
| `Alt+Enter` | on top of the dashboard |
| `Tab` | complete a shortcut (`!y` → `!yt `) |

**Start typing anywhere** (Settings → General): every letter typed on the dashboard opens quick launch with it. Edit mode is then `Shift+E`.

## Search shortcuts

Type `!` and a key before the search words — in quick launch **and** in every search block:

| Shortcut | Searches |
| --- | --- |
| `!g` | Google |
| `!ddg` | DuckDuckGo |
| `!yt` | YouTube |
| `!w` | Wikipedia |
| `!gh` | GitHub |
| `!dh` | Docker Hub |
| `!r` | Reddit |
| `!maps` | OpenStreetMap |

Add your own under **Settings → General → Search shortcuts**: a key (lower-case letters and digits), a name and an address with `%s` where the words go, e.g. `!arr` → `https://wiki.servarr.com/?search=%s` or `!tw` → your Tidewiki's search page. A shortcut without words (`!yt`) opens the address with an empty search. **Defaults** restores the list.

The engine for plain web searches in quick launch is set there too; search blocks have their own.

## Ways to open an app

| How | |
| --- | --- |
| Click | the way set in the app's **Open in**: new tab, same tab, or on top of the dashboard |
| Middle-click, `Ctrl`+click | always a new tab |
| `Alt`+click | on top of the dashboard |
| Right-click | a menu: open here, new tab, on top of the dashboard, copy link |

**On top of the dashboard** shows the app in a large panel over the board — handy for a quick look at a status page or a download queue. Close it with `Esc`; **New tab** moves it to a tab.

::: warning Panel stays empty?
Many apps (Proxmox, Home Assistant, most login pages …) forbid being shown inside another page. The panel then stays empty or says “refused to connect”. Set those apps to open in a new tab.
:::

Next: [[tidedeck-security|Sign-in and security]].
