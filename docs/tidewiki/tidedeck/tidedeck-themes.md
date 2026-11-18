---
title: "Look, size and wall screens"
---

All of this is under **Settings → Look** (edit mode → gear). Changes apply instantly for everyone.

![Look settings with presets, size and page width](/media/tidedeck-look-settings.webp)

## Presets and colours

Nine presets set colours, background and font in one click: **Tide** (the Tidewiki look), Harbour night, Sandbar, Kelp forest, Heather, Aurora, Paper, Phosphor and Clear view (Atkinson Hyperlegible, made for easy reading). Everything they set can then be changed:

| Setting | |
| --- | --- |
| Default theme | light, dark or the device's setting; every browser can still switch with the sun/moon button |
| Accent colour | buttons, highlights, status — separately for light and dark if you like |
| Font | Inter, IBM Plex Sans, Manrope, Space Grotesk, Nunito, Atkinson Hyperlegible, Source Serif, JetBrains Mono, the system font, or any font installed on your devices |
| Background | theme default, your own colour (blocks and lines are tinted to match), a gradient, or an image with blur and darkening |
| Header band | its colour in light and dark |
| Block opacity | lets a background image show through |
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
