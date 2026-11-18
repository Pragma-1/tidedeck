---
title: "Music"
---

The **Music** block plays from your own Navidrome (or any Subsonic-compatible server), or shows the official player of Spotify, YouTube or Deezer.

![The Navidrome player with an album open](/media/tidedeck-music.webp)

## Navidrome / Subsonic

1. **Add block → Music**, source **Navidrome**.
2. Enter the server address (e.g. `http://10.0.2.5:4533`), and either username and password or an OpenSubsonic API key.
3. **Connect** — Tidedeck tests the login and shows the server's version.

What you get:

- Search for songs and albums, tabs for **Albums**, **Playlists**, **Recently played** and **Random**.
- Play, pause, previous/next, shuffle, repeat, seek, volume — and **Stop listening** (the square), which ends playback completely.
- **Shuffle all** lets the server pick.
- Media keys on the keyboard and the phone's lock screen control it; plays are scrobbled to Navidrome.
- Playback continues while you switch boards or edit. When the block isn't visible, a small player appears in the header.

::: tip Block size
Make the block about 15 rows tall (a little over a third of a screen) to see search and library. A smaller block is just the player.
:::

| Option | |
| --- | --- |
| Let visitors play music | Off by default — only you can play. On: everyone who can open the dashboard can listen |
| Streaming quality | Original file, or transcoded to 320/192/128 kbit/s for mobile data |

**How it works:** the browser never talks to Navidrome. Audio and covers stream through Tidedeck, so the block also works when Navidrome is only reachable inside your network. The login is stored on the server, encrypted (AES-256-GCM), and never sent to the browser. Only audio passes through the stream; covers must be ordinary images.

## Spotify, YouTube / YouTube Music, Deezer

Choose the source and paste a share link (playlist, album, track, video). The block shows the service's own player. Their limits, which Tidedeck can't change:

| Service | |
| --- | --- |
| Spotify | Full songs only if you're signed in to spotify.com in the same browser; otherwise 30-second previews |
| YouTube / YouTube Music | YouTube Music can't be embedded, so its playlists play in the YouTube player (privacy-enhanced `youtube-nocookie.com`) |
| Deezer | Songs play as 30-second previews; podcasts in full. Use the full `deezer.com` link, not a short link |

Next: [[tidedeck-search|Search and quick launch]].
