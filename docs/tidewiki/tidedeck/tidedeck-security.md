---
title: "Sign-in and security"
---

## One password

Tidedeck has a single admin password. Signed in, you can edit; everyone else can only look (or nothing at all, in private mode).

- **First password:** needs the setup code from `docker logs tidedeck`, or `ADMIN_PASSWORD` before the first start — see [[tidedeck-installation|Installation]].
- **Change it:** Settings → Password. All other browsers and devices are signed out.
- **Sign out everywhere else:** same tab — useful after signing in on a borrowed device.
- **Forgotten:** see [[tidedeck-troubleshooting|Troubleshooting]].

A sign-in stays valid for 30 days in that browser.

## Private mode

**Settings → General → Require sign-in to view.** Visitors then see only a sign-in card; the dashboard, its apps and all data behind it (feeds, status, music, uploaded icons) need a sign-in.

Without it, everyone who can open the page sees the whole dashboard, **including the addresses of your apps and the content of notes**. That is fine on a home network; on the internet, use private mode or your proxy's login.

## Wrong passwords

After 5 wrong passwords, that device has to wait 30 seconds, doubling with every further try up to 15 minutes. Many failures from many devices slow everyone down a little — browsers that are already signed in aren't affected.

::: warning Publish through the proxy only
The lock-out recognises devices by the address the proxy or Cloudflare reports. Someone who reaches the port **directly** could fake that address. Keep the port on the LAN and publish Tidedeck only through the proxy or tunnel.
:::

## What protects what

| | |
| --- | --- |
| Password | scrypt hash; never stored in readable form |
| Sessions | signed, `HttpOnly` cookies; `Secure` over HTTPS |
| Other cookies | `td_locale` holds the browser's language and time zone, so the server can render the clock right away; it is checked before use and only affects formatting |
| Changes | only from the dashboard's own page (no other site can send them, not even a sibling subdomain) |
| Page | a strict Content-Security-Policy: injected code can't run |
| Links | `javascript:` and `data:` links are refused everywhere |
| Uploads | only real images; SVGs can't run scripts |
| Music logins, weather keys | encrypted on the server, never sent to the browser |
| Outbound | the server only contacts addresses you saved and the fixed address of the chosen weather source, with size limits; visitors don't see network errors |
| Container | unprivileged user, no capabilities, read-only system files |

The full list is in [SECURITY.md](https://github.com/Pragma-1/tidedeck/blob/main/SECURITY.md). Report vulnerabilities privately through GitHub (**Security → Report a vulnerability**), not as an issue.

## Turning sign-in off

`AUTH_DISABLED=true` lets everyone edit. Only use it when a proxy in front (Authelia, Authentik, Cloudflare Access …) already decides who gets in.

Next: [[tidedeck-themes|Look, size and wall screens]].
