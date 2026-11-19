# Security

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Use GitHub's private reporting instead: **Security → Report a vulnerability** on this repository. Include what you found, how to reproduce it and which image tag you tested. You will get an answer within a week; fixes are released as a new `latest` image and noted in the [changelog](CHANGELOG.md).

## Supported versions

Only the newest release (`astaldoo/tidedeck:latest`) receives security fixes. Data is migrated automatically on start, so updating is `docker compose pull && docker compose up -d`.

## What visitors can see

Unless **Require sign-in to view** is on, everyone who can open the page sees the whole dashboard, including app addresses such as internal IPs and the content of notes. Editing always needs the password. If Tidedeck is reachable from the internet, turn private mode on or put it behind your proxy's login.

## Design

### Accounts

| Area | Implementation |
| --- | --- |
| Password | scrypt (N = 2^15, r = 8, p = 1), 8–512 characters. At most two hashes run at a time, so a flood of logins queues instead of exhausting memory. |
| First password | Needs the one-time setup code printed in the server log (or `ADMIN_PASSWORD` before the first start), so nobody who merely reaches the page can claim the dashboard. The code works once. |
| Sessions | HMAC-SHA256-signed cookie with expiry and a session version; `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS. Changing the password or "Sign out everywhere else" bumps the version and invalidates every other session, stolen cookies included. |
| Locale cookie | `td_locale` (language and time zone, set by the page itself) lets the server render the clock and calendar. It is length-limited, matched against strict patterns and checked by `Intl` before use; anything else is ignored. It only changes how dates are formatted. |
| Lock-out | 5 wrong passwords lock that client for 30 s, doubling with every further failure up to 15 min. Many failures across all clients slow everyone down a little; signed-in browsers are unaffected. The client is identified by `CF-Connecting-IP`, `X-Real-IP` or the last `X-Forwarded-For` entry — keep the port on your LAN and publish it only through the proxy or tunnel, or clients can forge these. |
| Damaged files | An unreadable `auth.json` stops sign-in (fail closed) instead of being recreated, which would reset the password. |

### Requests and content

| Area | Implementation |
| --- | --- |
| CSRF | Every change must be JSON, carry a same-origin `Origin` (if any) and, where browsers send it, `Sec-Fetch-Site: same-origin` — so not even a sibling subdomain can send one. Uploads also need a custom header. |
| CSP | Per-request nonce with `strict-dynamic`, no inline scripts without it, `frame-ancestors 'self'`, `X-Frame-Options`, `Cross-Origin-Opener-Policy`, a restrictive `Permissions-Policy`. API answers carry `Content-Security-Policy: sandbox` and `Cross-Origin-Resource-Policy: same-origin`. |
| Validation | Every saved dashboard passes a strict schema on the server: link schemes (`javascript:`, `data:`, `vbscript:` refused, also obfuscated), colours, font names, sizes, list lengths. Layout values are clamped so a tampered file can't make viewers' browsers build gigantic boards. Theme CSS is escaped before it reaches a `<style>` element. |
| Content | Markdown never renders raw HTML. Feed titles are stripped of tags and only `http(s)` links are kept. Embedded pages and the app overlay are sandboxed and can't navigate the dashboard. |
| Uploads | Images only, decided by their bytes, 1 MB at most, stored under their content hash. SVGs are served with `Content-Security-Policy: sandbox`. |
| Limits | Bodies are read with a running limit (4 KB logins, 2 MB dashboard, 1 MB icons). Live-update streams are capped at 200, and 24 per client. Imports from other dashboards are capped at 1 MB with YAML alias expansion limited. |

### Outbound requests

| Area | Implementation |
| --- | --- |
| Targets | The server only checks status, reads feeds or talks to Navidrome for addresses saved in the dashboard by the admin, and loads the weather from the fixed address of the chosen source. It is no open proxy. |
| Feeds | Read with a 5 MB running limit, redirects followed at most 5 times and only to `http(s)`, `DOCTYPE`/entity declarations removed before parsing (no "billion laughs"), failures cached for 2 minutes. |
| Music | Library answers capped at 8 MB. The stream proxy only passes audio through — anything else (an HTML error page, say) is sent as `application/octet-stream` — and covers must be raster images (SVG refused). Credentials are encrypted with AES-256-GCM, never sent to the browser. |
| Weather | Only the fixed address of the block's source (Open-Meteo, OpenWeatherMap, WeatherAPI.com, Google, Apple), never redirects (a key in the address can't travel on), 10 s timeout, answers capped at 2 MB and checked field by field. Place, units and source come from the saved block, never from the request; one answer per block is shared for 10 minutes, so visitors can't use up a key's quota. Keys are saved only after a successful test, by a signed-in admin, encrypted with AES-256-GCM, never sent to the browser or written to the log; error messages never contain the request address. Apple tokens are signed on the server (ES256, 1 hour). |
| Status | Visitors see up/down and response time, not the underlying network errors (host names, internal messages). |

### Container

The compose file runs with `no-new-privileges`, `cap_drop: ALL` plus only `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `SETUID`, `SETGID` (used by the entrypoint to hand `./data` to `PUID:PGID` and drop to that user), a read-only root file system and `/tmp` as tmpfs. The server itself runs as `PUID:PGID` without capabilities. `PUID=0` is refused, the data folder is `chmod 700`, `auth.json` and `secrets.json` are `600`.
