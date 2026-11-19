# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.2.0] — 2026-11-19

### Added

- 18 more fonts, grouped in the font list: friendly (Comfortaa, Quicksand, Syne, Bricolage Grotesque), serif (Fraunces, Playfair Display, DM Serif Display), futuristic (Orbitron, Exo 2, Unbounded), condensed (Oswald, Big Shoulders), retro (VT323, Pixelify Sans, Silkscreen, Special Elite, Courier Prime), handwritten (Caveat) and Recursive. Fonts with very small lowercase letters are scaled to read like the others.
- 20 more presets in groups: colour schemes (Nord, Dracula, Gruvbox, Catppuccin, Tokyo Night, Rosé Pine, Solarized), styles (Synthwave, Terminal, Typewriter, Editorial, Blueprint, Arcade, Poster, Notebook) and sea and nature (Deep sea, Coral reef, Arctic, Sunset, Moss), with three new gradients (Synthwave, Sunset, Reef).

### Changed

- Background tabs only show the choices now; the background changes when you pick something in a tab (or click its **Use …** button). Looking at another tab no longer throws away the gradient or image in use. The tab in use has a dot.
- Header band and block opacity have their own section (“Header and blocks”), and custom CSS too; they no longer look like part of every background tab.
- Every push to `main` now publishes the image to Docker Hub after the checks pass (`latest`, plus `<version>` and `<major>.<minor>` for a new version); a `v<version>` tag publishes that version again. Images carry provenance and an SBOM; the workflow's actions are pinned to exact commits.
- A page loads only the font in use: the selectable fonts are separate small stylesheets in `/fonts` (cached for a year) instead of part of every page's CSS, which is about 10 % smaller.

### Fixed

- Dragging through the colour pickers lagged: every movement copied and redrew the whole dashboard. Changes now go to the dashboard at most once per frame, unchanged boards and blocks keep their identity, and the board and header are only redrawn when their own data changes. Each picker movement went from about 18 ms to under 1 ms of work (measured in a test browser); the same helps every slider and live sync.

## [1.1.0] — 2026-11-18

### Added

- Weather: choose the source per block — Open-Meteo (default, no key), OpenWeatherMap, WeatherAPI.com, Google Weather or Apple Weather (WeatherKit). Keys are entered once in the block's settings, tried before they are saved, stored encrypted on the server for all weather blocks and never sent to a browser. Google and Apple data carry the source line their terms ask for.

### Changed

- The weather is now loaded by the Tidedeck server instead of each viewer's browser, and shared by all viewers for 10 minutes. It works behind DNS filters, and the browser no longer contacts `api.open-meteo.com` (removed from the Content-Security-Policy). The server needs internet access to the chosen source.
- Choosing a place for the weather also stores its time zone.

## [1.0.1] — 2026-11-18

### Changed

- The normal size (100 %) is what used to be 90 %: everything is a little smaller. A size set to 90 % before is now 81 %; set it back to 100 % for the old 90 % look.
- A zoomed-out block can be made smaller than its usual minimum (the minimum follows the content zoom).
- Editing: the edges where a moved or resized block meets its neighbours light up, the drop outline is clearer, and blocks that make way move more calmly.
- Clock: the time's size follows the block's height; the width only limits it when it would no longer fit. The time now turns over exactly on the minute (it could lag up to 5 seconds).

### Fixed

- Edit mode could crash (“Something went wrong” / “This page couldn't load”, React error #185) when the dashboard was shown larger than about 107 % — for example with automatic size on a 1440p or larger screen, or a fixed size of 110 % or more. The editor's first, provisional measurement put the desktop board into the medium-screen size for a moment. While crashing it could also save the medium-screen arrangement as the desktop one. The editor now uses the real width and size from the first moment, starts a fresh grid for each screen size, and never reports one size's arrangement as another's.
- Just opening edit mode on a narrower screen no longer fixes that screen's automatic layout; it becomes its own only once something is moved there (as documented). Opening and closing edit mode without changes no longer saves anything.
- Editing in a tab that was opened before an update failed with “This page couldn't load”: the tab still asked for the editor parts of the old version, which no longer exist. A tab now reloads straight back into edit mode when that happens, and open tabs pick up a new version by themselves at a quiet moment (not while editing, typing, with a dialog open or while music plays).
- Errors now show a Tidedeck error page with “Reload” and “Try again” instead of the browser's generic message.
- Live sync reconnects right after the server restarts (an update kept the old connection open until it timed out).
- A layout that lists the same block twice (hand-edited or from an import) no longer shows it twice in the editor; the first position counts.

## [1.0.0] — 2026-11-10

First public release.

### Added

- Fast first load: the board is rendered by the server and shown with the page; the editor, dialogs, Markdown and the music player load only when used (the scripts a visitor needs to load the page are about 40 % smaller). Clock and calendar render with the page in the browser's language and time zone (`td_locale` cookie).
- Editing in the browser: free placement (blocks stay where you drop them, empty space included), drag, resize from any corner or edge (neighbours get narrower instead of jumping underneath, dragged blocks fit into smaller gaps, blocks that made way return when there's room again), a fine grid (48 columns, 9 px rows) that grows in every direction (past the left edge too), boards as tabs, copying or moving blocks and apps between boards and app groups, separate layouts for desktop, tablet and phone, undo for removed blocks, live sync between tabs and devices with conflict detection.
- Blocks: app, app group (tiles, list, compact bookmarks; custom, A–Z, Z–A or random order), search, clock (greeting, world clocks), calendar, weather, server resources, RSS (GitHub releases, YouTube channels and subreddits by name), notes, checklist, music, embedded page.
- Status lights that are easy to tell apart on any theme: lit green, lit red that pulses (no pulsing with reduced motion), and an empty ring while a service hasn't been checked yet.
- Music: a full Navidrome/Subsonic player streamed through Tidedeck, plus Spotify, YouTube and Deezer embeds.
- Quick launch (`Ctrl/⌘+K` or typing anywhere) over every app, typed addresses, search shortcuts (`!yt …`) and web search.
- Open apps in a new tab, the same tab, or on top of the dashboard; context menu with every option.
- Wall-screen mode (`?kiosk`, `&rotate=`).
- Looks: nine presets, accent colours, fonts, backgrounds, header band, block opacity, custom CSS.
- Size: auto-scaling to the screen (browser zoom works on top), fixed size, page width, per-device size, per-block content zoom.
- Icons from selfh.st/icons and dashboard-icons, uploads, favicons.
- Import from Homepage, Dashy and Homer.
- Installable as an app (web app manifest).
- Admin password with a one-time setup code, private mode, sign out everywhere, export/restore, automatic backups.
