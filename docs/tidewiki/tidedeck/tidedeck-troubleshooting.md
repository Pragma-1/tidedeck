---
title: "Troubleshooting"
---

Most problems show up in the container log first:

```bash
docker logs tidedeck --tail 50
```

## The page doesn't open

| Symptom | Cause and fix |
| --- | --- |
| “Connection refused” | Check the mapping: `docker ps` must show `0.0.0.0:<PORT>->3000/tcp`. Inside the container Tidedeck always listens on **3000** — don't set `PORT` in the container's environment yourself, only in `.env` for the mapping |
| Container restarts at once, log says `Refusing to run the server as root` | `PUID=0` in `.env`. Use a normal user's id (`id -u`) |
| Log says `PUID and PGID must be numbers` | A typo in `.env` |
| Errors writing to `./data` | The folder belongs to another user. Tidedeck fixes ownership itself on start; on NAS systems with special ACLs set `PUID`/`PGID` to the folder's owner |
| The container doesn't start at all on an older NAS | Remove `read_only`, `cap_drop`/`cap_add` or `security_opt` from the compose file, one at a time |

## Sign-in

| Symptom | Fix |
| --- | --- |
| Setup code lost | `docker logs tidedeck` shows it again after a restart (`docker restart tidedeck`) |
| Password forgotten | Stop the container, delete `data/auth.json`, start it again — a new setup code is printed. Everyone is signed out, and **music logins and weather keys must be entered again** (they were encrypted with the old key; the old file is kept as `secrets.json.unreadable-…`) |
| “Too many attempts. Try again in … s.” | Wait — the lock-out doubles with each wrong try, up to 15 minutes. Signed-in browsers are unaffected |
| Log says `auth.json is damaged` | Restore it from a backup of the `data` folder, or delete it as above. Tidedeck refuses to guess, so the password can't silently be reset |

## Blocks

| Symptom | Cause and fix |
| --- | --- |
| Status dot red, but the app works | The **server** checks it, not your browser. From inside the container the name may not resolve or a firewall may block it: enter the internal IP under **Check a different address**, and turn on **Accept self-signed certificates** for HTTPS with its own certificate |
| Weather: “The Tidedeck server can't reach …” | The **server** loads the weather. Test from the container: `docker exec tidedeck wget -qO- "https://api.open-meteo.com/v1/forecast?latitude=52.5&longitude=13.4&current=temperature_2m"` |
| Weather: “… refused the key” | The key is wrong, not active yet (OpenWeatherMap: up to a couple of hours after creating it), or the API isn't enabled for it (Google: enable the **Weather API** in the Cloud console; Apple: enable **WeatherKit** for the key and the Services ID) |
| Weather: “Add the … key in this block's settings” | The source needs a key; enter it under **Weather source**. Keys are kept with the music logins, so after resetting the password they must be entered again |
| Icons show only a letter | Icons come from `cdn.jsdelivr.net`. A DNS filter (Pi-hole, AdGuard) or no internet on that device blocks them — allow the domain, or upload the icons |
| Embedded page or “On top of the dashboard” stays empty | The site forbids being embedded. Nothing to fix in Tidedeck; open it in a new tab |
| RSS: “fetch failed” | The server can't reach the feed. Test with `docker exec tidedeck wget -qO- <feed-url>` |
| Music: “Can't reach the server” | The **Tidedeck server** must reach Navidrome (not your browser). Use the address that works from the Docker host |
| Spotify/Deezer play only 30 seconds | A limit of their embedded players — see [Music](/w/tidedeck-music) |
| Server resources show the wrong disk | Mount the disk into the container read-only and enter its path |

## Layout

| Symptom | Fix |
| --- | --- |
| The phone shows a different arrangement | Correct — each screen size keeps its own layout. Arrange it on the phone, see [Editing the board](/w/tidedeck-layout) |
| Everything is huge on the TV, or tiny | Settings → Look → Size, and **Only on this device** for just that screen |
| A block's text is too large or small | Its content zoom: the percentage in the block's toolbar resets it |
| Changes don't appear in another tab | That tab lost the connection; it reconnects by itself within seconds, or reload |
| “This page couldn't load” when editing (before 1.0.1) | The tab was opened before an update and asked for parts of the old version. Reload once; from 1.0.1 on the tab does this by itself |
| “Something went wrong” | Click **Try again**, or **Reload**. If it comes back, the container log and the code shown on the page help to find the cause |

## The dashboard is gone or broken

If `dashboard.json` was damaged, Tidedeck moves it aside (`dashboard.json.broken-…`) and loads the newest valid backup by itself. To go back further, see [[tidedeck-updates-and-backups|Updates, backups and moving]].
