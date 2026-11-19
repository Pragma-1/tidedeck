---
title: "Look, size and wall screens"
---

All of this is under **Settings → Look** (edit mode → gear). Changes apply instantly for everyone.

![Look settings with presets, size and page width](/media/tidedeck-look-settings.webp)

## Presets and colours

Presets set colours, background and font in one click:

| Group | Presets |
| --- | --- |
| Tide | **Tide** (the Tidewiki look), Harbour night, Sandbar, Kelp forest, Heather, Aurora, Paper, Phosphor, Clear view (Atkinson Hyperlegible, made for easy reading) |
| Colour schemes | Nord, Dracula, Gruvbox, Catppuccin, Tokyo Night, Rosé Pine, Solarized — each with its light variant |
| Styles | Synthwave, Terminal, Typewriter, Editorial, Blueprint, Arcade, Poster, Notebook |
| Sea and nature | Deep sea, Coral reef, Arctic, Sunset, Moss |

Everything they set can then be changed:

| Setting | |
| --- | --- |
| Default theme | light, dark or the device's setting; every browser can still switch with the sun/moon button |
| Accent colour | buttons, highlights, status — separately for light and dark if you like |
| Font | 27 fonts in groups — clean (Inter, IBM Plex Sans, Manrope, Atkinson Hyperlegible), friendly (Space Grotesk, Nunito, Comfortaa, Quicksand, Syne, Bricolage Grotesque), serif (Source Serif, Fraunces, Playfair Display, DM Serif Display), futuristic (Orbitron, Exo 2, Unbounded), condensed (Oswald, Big Shoulders), retro (VT323, Pixelify Sans, Silkscreen, Special Elite, Courier Prime), handwritten (Caveat), monospace (JetBrains Mono, Recursive) — plus the system font or any font installed on your devices. All are part of the image; a page loads only the one in use |
| Background | theme default, your own colour (blocks and lines are tinted to match), a gradient (Aurora, Tide pool, Dusk, Mist, Synthwave, Sunset, Reef), or an image with blur and darkening. The tabs only show the choices: the background changes when you pick something in a tab or click its **Use …** button, and the tab in use has a dot |
| Header and blocks | the header band's colour in light and dark, and the block opacity (lets a background image show through) |
| Custom CSS | for everything else |

![The same board in the light theme](/media/tidedeck-board-light.webp)

## Size

By default the dashboard **fits the screen**: on monitors up to 2048 px wide it's shown at 100 %; on wider ones everything — text, blocks, grid, page width — grows with the monitor: 125 % at 2560 px, about 190 % on a 4K screen at 100 % scaling. It goes by the monitor, not the window, so **browser zoom** (`Ctrl` + `+`/`−`) still makes everything larger or smaller as usual.

| Setting | |
| --- | --- |
| Fit the screen / Fixed | automatic, with **Adjust** to make it a bit smaller or larger; or one fixed size everywhere |
| Page width | **Standard**, **Wide** or **Full width** — how wide the board may get before it's centred |
| Only on this device | this browser keeps its own size, e.g. the TV in the hallway. Stored in that browser only |

At a larger size a narrow window gets the tablet layout, just like browser zoom. For single blocks there is the **content zoom** — see [[tidedeck-layout|Editing the board]].

## Wall screens

![Wall-screen mode on a 2560 px display](/media/tidedeck-kiosk.webp)

**Settings → General → Wall screen (kiosk)** copies a link like:

```text
http://dash.lan:3004/?board=home&kiosk&rotate=60
```

| Part | |
| --- | --- |
| `kiosk` | no header, no edit button, the board fills the screen; the mouse pointer hides after a few seconds |
| `rotate=60` | the next board every 60 seconds (10 at least) — leave it out to stay on one board |
| `board=…` | the board to start with |

`Esc`, or a double-click/double-tap in the top-left corner, brings the header back. Together with **Only on this device** the wall screen gets exactly the size it needs.

## Install as an app

In Chrome, Edge or on Android: the install button in the address bar or **Add to home screen**. On iPhone/iPad: Share → **Add to Home Screen**. Tidedeck then opens in its own window with its icon.

![Tidedeck on a phone](/media/tidedeck-phone.webp)

Next: [[tidedeck-troubleshooting|Troubleshooting]].
