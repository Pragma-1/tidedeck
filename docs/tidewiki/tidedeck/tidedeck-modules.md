---
title: "Blocks"
---

Add blocks with **Add block** in edit mode; double-click a block for its settings. Every block has a **title** (shown or hidden) and a **content zoom** — see [[tidedeck-layout|Editing the board]].

## Apps

**App** is a single service as a large tile. **App group** collects several under a heading — the block you'll use most.

| Option | |
| --- | --- |
| Layout | **Tiles**, **List**, or **Compact** — small link chips, ideal as a bookmark bar |
| Order | **Custom** (drag the tiles in edit mode), **A to Z**, **Z to A**, **Random** (new order on every page load) |
| Show descriptions / Show online status | Per group |

Each link has:

| Field | |
| --- | --- |
| Name, Description | Description is the small grey line |
| Link | `https://…`, `http://10.0.2.5:8006`, also `ssh://`, `smb://` and the like. `javascript:` and `data:` are refused |
| Icon | Picker with [selfh.st/icons](https://selfh.st/icons/) and dashboard-icons (light/dark variants), upload, any image link, or empty for the site's favicon. Short forms: `sh:immich`, `sh:immich-light`, `di:proxmox` |
| Open in | **New tab**, **Same tab**, or **On top of the dashboard** — see [Search and quick launch](/w/tidedeck-search) |
| Check if it's online | The server asks the link (or a **different address**, e.g. an internal IP or `/health`) and shows a dot |
| Accept self-signed certificates | For services with their own HTTPS certificate |

::: info What the dots mean
**Green light:** the service answered — login pages (401/403) count. **Red, pulsing:** no answer, or a server error (5xx). **Empty ring:** not checked yet. Hover for the response time. The interval is set under Settings → General.
:::

## Search

Filters your apps while you type and searches the web on Enter. Engines: DuckDuckGo, Google, Bing, Startpage, Brave or a custom address with `%s` (e.g. your SearXNG). Search shortcuts like `!yt lofi` work here too. `/` jumps into the box.

## Clock and calendar

**Clock** — time zone (empty = the viewer's), 12/24 hours, seconds, date, and:

- **Greeting** — “Good morning, Alfons”, changing through the day.
- **More time zones** — up to eight world clocks below, with a “+1” when it's already tomorrow there.

In a small block the extras step back by themselves (greeting first, then world clocks, then the date). The time gets bigger with a taller block; making the block wider or narrower doesn't change it, unless it would no longer fit.

**Calendar** — a month view; week starts Monday or Sunday.

## Weather

Current weather and forecast. Search the place by name, choose °C or °F and 0–7 forecast days, and pick where the weather comes from under **Weather source**:

| Source | Needs | Forecast |
| --- | --- | --- |
| Open-Meteo (default) | nothing | 7 days |
| OpenWeatherMap | an [API key](https://home.openweathermap.org/api_keys); the free plan works (a new key can take a couple of hours to start working) | 4 days |
| WeatherAPI.com | an [API key](https://www.weatherapi.com/my/) | 2 days on the free plan, more on paid ones |
| Google Weather | a Google Maps Platform API key with the **Weather API** enabled; Google requires a billing account (a monthly free amount applies) | 7 days |
| Apple Weather (WeatherKit) | an Apple Developer Program membership: a WeatherKit key (`.p8` file), its **Key ID**, your **Team ID** and a **Services ID** | 7 days |

For a source with a key, enter it right below the source and click **Save and test**: Tidedeck tries it on a real request before saving it. A key is saved **once for all weather blocks**, encrypted on the server, and never sent to a browser. **Remove key** deletes it again.

**How it works:** the Tidedeck server loads the weather, not the viewer's browser, and shares one answer with every viewer for 10 minutes. So the block works behind DNS filters, and a key costs at most one round of requests per block every 10 minutes (Google: 2 requests, at most about 9,000 a month per block shown around the clock, within its free amount). The server needs internet access to the chosen source.

Google and Apple require their name to be shown with their data, so the block shows a small source line for every source except Open-Meteo.

## Server resources

CPU, memory, disk and uptime of the machine Tidedeck runs on. To measure a disk other than the container's, mount it read-only (`- /mnt/tank:/mnt/tank:ro`) and enter `/mnt/tank` as the path.

## RSS feed

Several RSS or Atom feeds merged into one list, newest first. **Add a feed by name** fills in the address for:

| Kind | Enter | Becomes |
| --- | --- | --- |
| GitHub releases | `immich-app/immich` | `https://github.com/immich-app/immich/releases.atom` |
| YouTube channel | the channel ID (`UC…`) | the channel's video feed |
| Subreddit | `selfhosted` | `https://www.reddit.com/r/selfhosted/.rss` |

Feeds are fetched by the server every 10 minutes.

## Notes and checklist

**Notes** — Markdown: headings, **bold**, lists, `- [ ]` task lists, tables, links. HTML isn't rendered.

**Checklist** — a to-do list you use right on the dashboard while signed in (no edit mode needed): tick, add at the bottom, remove with ×, **Clear done**. Done items can move to the bottom. Visitors see the list but can't change it.

## Music

A full Navidrome/Subsonic player, or the Spotify, YouTube and Deezer players — its own chapter: [[tidedeck-music|Music]].

## Embedded page

Shows another web page inside the block, e.g. a Grafana dashboard or an Uptime Kuma status page. Many sites forbid being embedded (`X-Frame-Options`); the block then stays empty — that is the site's decision, not an error in Tidedeck. The page runs sandboxed and can't navigate the dashboard.

Next: [[tidedeck-music|Music]].
