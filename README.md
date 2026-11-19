<p align="center">
  <img src="docs/logo.svg" alt="" width="88" height="88">
</p>

<h1 align="center">Tidewiki</h1>

<p align="center">
  A self-hosted Markdown wiki that stays out of your way — live pages, real search, two-factor sign-in<br>
  and GDPR tooling. Two containers — the wiki and its PostgreSQL database — and encrypted backups.
</p>

<p align="center">
  <a href="https://github.com/Pragma-1/tidewiki/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Pragma-1/tidewiki/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://hub.docker.com/r/astaldoo/tidewiki"><img alt="Docker image" src="https://img.shields.io/badge/docker-astaldoo%2Ftidewiki-2a2f36?logo=docker&logoColor=white"></a>
  <a href="https://hub.docker.com/r/astaldoo/tidewiki"><img alt="Docker pulls" src="https://img.shields.io/docker/pulls/astaldoo/tidewiki?color=3d5a80"></a>
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-2a2f36?logo=nextdotjs">
  <img alt="Node 22" src="https://img.shields.io/badge/node-22-3d5a80?logo=nodedotjs&logoColor=white">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3d5a80"></a>
</p>

<p align="center">
  <img src="docs/screenshots/page.png" alt="A wiki page with chapter navigation, table of contents, callout and task list" width="880">
</p>

> The interface is in **German**. Code, documentation and translation keys are English.

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Screenshots](#screenshots)
- [Administration](#administration)
- [Writing pages](#writing-pages)
- [Privacy and GDPR](#privacy-and-gdpr)
- [Security](#security)
- [Development](#development)
- [Project layout](#project-layout)
- [License](#license)

## Features

**Reading and writing**

- Chapters and pages in Markdown with a live preview, toolbar, drafts that survive a closed tab, and `Ctrl/⌘+S`.
- Pages update **live** for everyone reading them (Server-Sent Events); edit conflicts are detected, never silently overwritten.
- Tables, task lists, footnotes, callouts, collapsible blocks, syntax highlighting with a copy button, `[[wiki links]]`, backlinks, previous/next navigation, table of contents, print layout, light and dark theme.
- Images and videos by upload, paste or drag & drop. YouTube and Vimeo load only after a click (two-click privacy). Every video has **picture-in-picture**.
- Links to other sites open in a new tab (`rel="noopener"`), internal links stay put.
- Version history with a line diff, restore of any version, edit summaries, and a "recent changes" feed.
- A trash: deleted pages keep their whole history for 30 days.
- _Seiten verwalten_: all pages as a tree with checkboxes to delete many at once (a chapter ticks its sub-pages, shift-click selects a range, filter). Editors delete their own pages, administrators any — all or nothing.
- Import and export: single pages as `.md`, the whole wiki as a ZIP (pages, chapters as folders, media), new pages straight from a `.md` file. Before importing a ZIP you can arrange it: change the order, make pages main pages or sub-pages, put them under an existing page, rename them or leave them out.

**Search**

- Results while you type, Enter for a full results page with highlighted snippets.
- Matches parts of words — `te` finds _Bitte_ — and ignores case and accents (`fur` → _für_, `strasse` → _Straße_).
- `*` wildcards inside a word (`wiki*`, `*ung`, `t*st`), `"exact phrases"`, several terms combined.

**Accounts and security**

- Roles: owner, administrator, editor, viewer. Public read-only mode or a fully private wiki.
- Argon2id passwords with a server-side pepper and a configurable password policy.
- TOTP two-factor authentication with **several devices** per account and single-use recovery codes, **required per role**.
- Escalating lock-out (10 min → 24 h), session overview with sign-out per device, self-service profile changes.
- Security log with event IDs, filters and CSV/JSON export.

**Operations**

- Wiki plus PostgreSQL 17 in its own container, on an internal network, with a dedicated database user that has no superuser rights. One `.env`. The wiki runs as an unprivileged user (`PUID`/`PGID`).
- **Encrypted backups** (AES-256-GCM) on a local disk, an NFS or SMB share, or any S3-compatible storage — scheduled or on demand. Restore a single page, a single account, or everything.
- SMTP from `.env` or from the settings page, with a test-mail button and HTML mails in the wiki's design.
- Generated privacy notice, terms of use and imprint (German _Impressum_), filled from your settings.

## Quick start

You need Docker with the Compose plugin.

1. Put [`docker.yaml`](docker.yaml) and a copy of [`.env.example`](.env.example) named `.env` into an empty folder:

   ```bash
   curl -fsSLO https://raw.githubusercontent.com/Pragma-1/tidewiki/main/docker.yaml
   curl -fsSL -o .env https://raw.githubusercontent.com/Pragma-1/tidewiki/main/.env.example
   ```

2. Edit `.env` — set `DB_PASSWORD` and `DB_ADMIN_PASSWORD` (`openssl rand -base64 32` each), and `WIKI_BASE_URL` if the wiki is reached under a domain.
3. Start it and read the one-time setup token from the log:

```bash
docker compose -f docker.yaml up -d
docker logs tidewiki
```

Open `http://<host>:3000/setup`, enter the token and create the owner account. That's it.

Needs **Docker Compose 2.23 or newer** (the database init script is inline under `configs`). The first start of the database creates the wiki's own user from `DB_USER` / `DB_PASSWORD`; changing those later has no effect on an existing database folder.

<details>
<summary><code>docker.yaml</code> (shortened — the real file also has the database init script and NAS examples)</summary>

```yaml
services:
  db:
    image: postgres:17-alpine
    container_name: tidewiki-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${DB_NAME:-tidewiki}
      POSTGRES_USER: ${DB_ADMIN_USER:-postgres}
      POSTGRES_PASSWORD: ${DB_ADMIN_PASSWORD:?Set DB_ADMIN_PASSWORD in .env}
      APP_DB_USER: ${DB_USER:-tidewiki}
      APP_DB_PASSWORD: ${DB_PASSWORD:?Set DB_PASSWORD in .env}
    configs:
      - source: db-init
        target: /docker-entrypoint-initdb.d/10-tidewiki.sh
    volumes:
      - ${DB_DATA:-./db}:/var/lib/postgresql/data
    networks: [backend]

  wiki:
    image: astaldoo/tidewiki:latest
    container_name: tidewiki
    restart: unless-stopped
    env_file: .env
    environment:
      WIKI_DB_HOST: db
      WIKI_DB_NAME: ${DB_NAME:-tidewiki}
      WIKI_DB_USER: ${DB_USER:-tidewiki}
      WIKI_DB_PASSWORD: ${DB_PASSWORD:?Set DB_PASSWORD in .env}
      WIKI_BACKUP_DIR: /backups
    depends_on:
      db: { condition: service_healthy }
    ports:
      - "${WIKI_PORT:-3000}:3000"
    volumes:
      - ${WIKI_DATA:-./data}:/data
      - ${WIKI_BACKUPS:-./backups}:/backups
    networks: [backend, frontend]

networks:
  backend: { internal: true } # the database is never reachable from outside
  frontend: {}
```

</details>

Works the same in Portainer, Arcane and similar UIs: create a stack from `docker.yaml` and paste the `.env` values.

**Behind a reverse proxy** (Caddy, Traefik, nginx): set `WIKI_BASE_URL=https://wiki.example.org` and `WIKI_TRUSTED_PROXY_HOPS=1`. HTTPS switches on secure cookies and HSTS automatically.

**Backups** are built in (_Einstellungen → Sicherungen_, see [Administration](#administration)). Keep a copy of the master key somewhere else — without it no backup can be read.

**Upgrading from 1.x** (single container with SQLite): replace `docker.yaml`, add the `DB_*` values to `.env` and start. On its first start against an empty database the wiki imports `data/wiki.db` once and renames it to `wiki.db.imported-<date>` — keep that file until you've checked everything is there.

## Configuration

Everything lives in `.env` ([`.env.example`](.env.example) explains each value). All of it is optional unless noted.

| Variable                                                                             | Default                     | Purpose                                                                                                           |
| ------------------------------------------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `PUID` / `PGID`                                                                      | `1000`                      | User and group the wiki runs as; the data folder is handed to them on start. `0` is refused.                      |
| `WIKI_PORT`                                                                          | `3000`                      | Host port.                                                                                                        |
| `WIKI_DATA`                                                                          | `./data`                    | Host folder or named volume for uploads and the generated master key.                                             |
| `WIKI_BACKUPS`                                                                       | `./backups`                 | Host folder or volume for backups (mounted at `/backups`). Another disk or an NFS/SMB volume — see `docker.yaml`. |
| `WIKI_BACKUP_ROOTS`                                                                  | `/backups,/mnt,/media,/srv` | The only folders (in the container) the owner may choose for backups in the settings.                             |
| `DB_NAME`, `DB_USER`                                                                 | `tidewiki`                  | Database name and the wiki's own database user (no superuser rights).                                             |
| `DB_PASSWORD`                                                                        | — **required**              | Password of that user.                                                                                            |
| `DB_ADMIN_USER`, `DB_ADMIN_PASSWORD`                                                 | `postgres`, **required**    | The database superuser. Only the database container gets it; must differ from `DB_USER`.                          |
| `DB_DATA`                                                                            | `./db`                      | Host folder for the database files. A local disk, not an SMB share.                                               |
| `WIKI_DB_HOST` … `WIKI_DB_PASSWORD`, `WIKI_DATABASE_URL`, `WIKI_DB_PASSWORD_FILE`    | set by `docker.yaml`        | Only for an existing PostgreSQL server instead of the container.                                                  |
| `WIKI_DB_SSL`                                                                        | `off`                       | `require` (encrypted) or `verify` (encrypted, certificate checked) for an external server.                        |
| `WIKI_BASE_URL`                                                                      | `http://localhost:3000`     | The exact address users type. Used for links in mails, cookies and the CSRF check.                                |
| `WIKI_ALLOWED_HOSTS`                                                                 | —                           | Extra host names (comma separated). Protects against DNS rebinding.                                               |
| `WIKI_TRUSTED_PROXY_HOPS`                                                            | `0`                         | Number of reverse proxies in front; only then are client IPs trusted.                                             |
| `WIKI_TIMEZONE`                                                                      | `UTC`                       | Time zone for dates in the interface and mails.                                                                   |
| `WIKI_MASTER_KEY`                                                                    | generated                   | Encrypts 2FA secrets and the SMTP password, peppers password hashes. `openssl rand -base64 48`. **Keep a copy.**  |
| `WIKI_SETUP_TOKEN`                                                                   | random                      | Your own one-time setup token (≥ 16 characters).                                                                  |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | —                           | Mail server. Can also be set in _Einstellungen → E-Mail_, which takes precedence.                                 |
| `WIKI_MASTER_KEY_FILE`, `SMTP_PASSWORD_FILE`                                         | —                           | Read the master key / SMTP password from a file instead (Docker secrets).                                         |
| `WIKI_MAX_VIDEO_MB`                                                                  | `200`                       | Largest video upload. Images are capped at 15 MB.                                                                 |
| `WIKI_MEDIA_QUOTA_MB`                                                                | `10240`                     | Total space for uploads.                                                                                          |
| `WIKI_MAX_IMPORT_MB`                                                                 | `1024`                      | Largest import file.                                                                                              |
| `WIKI_MAX_BACKUP_UPLOAD_MB`                                                          | `20480`                     | Largest backup ZIP that can be uploaded.                                                                          |

S3 storage for backups is set up in the wiki (_Einstellungen → Sicherungen_), not in `.env`. Everything else — registration, roles, two-factor requirements, password policy, retention periods, operator details for the legal pages — is configured in the wiki under **Einstellungen**.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/search.png" alt="Search results appearing while typing"><br><sub>Search while you type — substrings, wildcards, highlights</sub></td>
    <td width="50%"><img src="docs/screenshots/editor.png" alt="Editor with toolbar and live preview"><br><sub>Editor with live preview</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/account.png" alt="Account page with authenticator devices and profile"><br><sub>Several authenticator devices, profile, sessions</sub></td>
    <td><img src="docs/screenshots/settings-security.png" alt="Security settings with two-factor per role and password policy"><br><sub>Two-factor per role, password policy, lock-out</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/page-dark.png" alt="Dark theme"><br><sub>Dark theme</sub></td>
    <td align="center"><img src="docs/screenshots/mobile.png" alt="Page on a phone" width="240"><br><sub>On a phone</sub></td>
  </tr>
</table>

## Administration

- **Owner.** The account created at setup. Only the owner creates, changes or deletes administrators and can hand ownership over (_Personen → Bearbeiten → Zum Inhaber machen_). Administrators manage editors and viewers.
- **People.** Add users with a generated password that meets the policy, change name, e-mail, role or password, unlock, reset 2FA, sign out everywhere, disable, export personal data, delete — deletion asks for the username to be typed.
- **Security.** Two-factor authentication can be required separately for administrators, editors and viewers. An administrator can only change it for roles _below_ their own; the owner can change it for every role. The password policy sets a minimum length (10–64) and minimum counts of digits, special characters, upper- and lower-case letters.
- **E-mail.** Server, port (mail ports only: 25, 26, 465, 587, 1025, 2525), encryption, user, password (stored encrypted, never shown again) and sender. _Test-E-Mail senden_ mails the signed-in administrator.
- **Lock-out.** After the configured number of failed sign-ins within 15 minutes: 10 min → 20 min → 1 h → 3 h → 6 h → 12 h → 24 h. A successful sign-in or an unlock resets it.
- **Emergency unlock**, e.g. when the owner is locked out:

  ```bash
  docker exec tidewiki node tidewiki-cli.cjs locked            # list locked accounts
  docker exec tidewiki node tidewiki-cli.cjs unlock <username>
  docker exec tidewiki node tidewiki-cli.cjs unlock --all
  ```

- **Trash.** Deleted pages go to _Papierkorb_ (rail, editors and up) with their whole history for 30 days, then they are removed for good. Editors restore; only administrators delete for good or empty it.
- **Versions.** Every save is a version, optionally with a one-line summary. In _Verlauf_ each version can be viewed, compared with the current one, downloaded as `.md` and restored — a restore adds the old text as a new version on top, so nothing is ever overwritten.
- **Backups.** _Einstellungen → Sicherungen_: one switch turns backups on or off (off: no automatic backups and no _Jetzt sichern_ — only the safety copy before a full restore or import is still made; existing backups can still be opened and restored). Automatic backups (default daily, the newest 14 kept), _Jetzt sichern_, and a safety copy before every full restore and import (the newest 5 kept). A backup holds every page with its whole history, the trash, accounts (with password hashes and 2FA devices), settings, legal texts, the security log and every upload. Sessions and reset links are never in it.
  - **Where:** a folder or any **S3-compatible storage**. The folder defaults to the `WIKI_BACKUPS` mount (`/backups`); the owner can pick another one in the settings, e.g. a NAS share mounted at `/mnt/nas` in `docker.yaml` (NFS/SMB examples there). Allowed are folders inside `/backups`, `/mnt`, `/media` and `/srv` (`WIKI_BACKUP_ROOTS`) that already exist and belong to `PUID:PGID` — never system folders, the wiki's own data, or a path through a symbolic link. A chosen folder is never created, so a share that isn't mounted fails loudly instead of filling the container's disk. Switching folders doesn't move existing backups. S3 is also set up by the owner in the wiki (AWS, MinIO, Wasabi, Backblaze B2, Hetzner, Garage …). Every change of the storage needs the owner's password and is tested (write, read back, delete) before it is saved. The S3 secret key is stored encrypted with the master key, never shown again, and not part of backups.
  - **Encrypted:** everything is encrypted and authenticated (AES-256-GCM in 64 KiB chunks, keys derived from the master key) before it leaves the wiki — the folder, NAS or bucket only ever sees ciphertext and random-looking file names. A changed, swapped or truncated file is refused. Uploads are deduplicated across backups.
  - **Restore what you need:** _Öffnen_ lists the pages and accounts in a backup. A **single page** comes back as a new version on top of the current one, or — if it was deleted — recreated with its whole history and its pictures. A **single account** can be brought back if it was deleted; its pages are linked to it again. Or **everything**, which replaces the whole wiki.
  - **Who may do what:**

    | Action                                                | Owner | Administrator | Editor / viewer |
    | ----------------------------------------------------- | :---: | :-----------: | :-------------: |
    | List, open, check, create a backup                    |   ✓   |       ✓       |        —        |
    | Restore a single page                                 |   ✓   |       ✓       |        —        |
    | Restore an editor's or viewer's account               |   ✓   |       ✓       |        —        |
    | Restore an administrator's account                    |   ✓   |       —       |        —        |
    | Restore everything (asks for the password)            |   ✓   |       —       |        —        |
    | Download, upload, delete; storage location (password) |   ✓   |       —       |        —        |

  - **The master key is not part of a backup** and is needed to read one. Keep it separately (a password manager, printed in a safe) — a backup without its key is worthless, and a key next to its backups protects nothing.
- **Security log.** Every entry has an ID (`EV-000123`) and can be searched by ID, event, user, IP and details, filtered by category, user and date, and exported as CSV or JSON.

## Writing pages

The built-in page **Markdown-Anleitung** shows every feature with its source. In short:

| Write                                               | Get                                                     |
| --------------------------------------------------- | ------------------------------------------------------- |
| `[[Seite]]`, `[[Seite\|Text]]`                      | link to another wiki page                               |
| `![Alt](/media/…)` / `@[Titel](https://youtu.be/…)` | image / video player or click-to-load embed             |
| `::: tip Titel` … `:::`                             | callout (`info`, `tip`, `warning`, `danger`, `details`) |
| `- [ ] Aufgabe`                                     | task list                                               |
| ` ```js `                                           | code block with highlighting and copy button            |
| `==markiert==`, `H~2~O`, `x^2^`, `[^1]`             | highlight, sub-/superscript, footnote                   |

Raw HTML is not rendered — everything you see comes from Markdown.

## Privacy and GDPR

- Every signed-in person can download their data and delete their account. Deletion removes the account, sessions, lock-out counters and every security-log entry by or about them; pages stay and show "deleted account" as author.
- IP addresses are only known behind a configured proxy and are removed after `ip_retention_days` (default 7); log entries after `log_retention_days` (default 180).
- Nothing is loaded from third parties until a reader clicks: fonts are self-hosted, YouTube/Vimeo and foreign images are two-click.
- The privacy notice is generated from the real configuration. It is a starting point, not legal advice.
- Terms of use and imprint can be switched off for a private wiki; the privacy notice always stays. When the wiki is served through Cloudflare (tunnel or proxy), the notice adds a section on what Cloudflare processes — detected automatically from the `CF-Ray` header.

**Deleted means gone.** When an account is erased, a page is deleted for good (trash emptied, single item, or after 30 days) or a file is deleted, the wiki removes it from the database and then rewrites the affected tables (`VACUUM FULL`): a plain `DELETE`, and even a plain `VACUUM`, leave the old bytes in PostgreSQL's files until something overwrites them — a test reads the raw database files to make sure the text is really gone. Deleted uploads are removed from the disk; files left behind by a crash are cleaned up hourly. What remains, by design or beyond the wiki's reach: older backups (until they rotate out), the security log entry that something was deleted (until log retention), PostgreSQL's write-ahead log (overwritten as the database keeps working), and the disk itself — a deleted file's blocks stay on the drive until reused, and in ZFS/Btrfs snapshots until those are removed. Data deleted before a backup isn't in it; data deleted afterwards stays in older backups until they rotate out — the privacy notice says so, with the configured schedule. **An account its owner erased themselves is never restored** from a backup, neither singly nor by a full restore (it is erased again right after); only the fact of the erasure is kept for that.

## Security

Passwords are hashed with Argon2id (64 MiB, t = 3) after an HMAC pepper. TOTP secrets, the SMTP password, the S3 secret and all backups are encrypted with AES-256-GCM. Every database query passes values as bound parameters (a tagged template that can't take anything else; a test fails on any raw query), and the wiki connects as a database user that can't read files, run programs or create roles. Sessions store only a hash of a 256-bit token. Every write is checked against the request origin. A strict nonce-based Content Security Policy is in place. Raw HTML is disabled before the sanitizer runs. Rate limits and CPU budgets cover every expensive endpoint.

See [SECURITY.md](SECURITY.md) for the full design and **how to report a vulnerability**.

## Development

Requirements: Node.js 22, npm and PostgreSQL 15 or newer. The tests start their own throw-away PostgreSQL from the installed binaries (`/usr/lib/postgresql/<n>/bin`, `pg_config`, or set `PG_BIN`) — no running server needed.

```bash
npm ci
docker run -d --name tw-dev-db -p 127.0.0.1:5432:5432 -e POSTGRES_DB=tidewiki \
  -e POSTGRES_USER=tidewiki -e POSTGRES_PASSWORD=dev postgres:17-alpine
WIKI_DATA_DIR=./data WIKI_DB_HOST=127.0.0.1 WIKI_DB_PASSWORD=dev npm run dev   # http://localhost:3000

npm run check          # typecheck + lint + formatting + unit tests
npm run build          # production build (standalone output, assets copied)
npm run test:e2e       # 300+ end-to-end checks against the production server
node tests/attack.mjs https://your-host   # fire the adversarial battery at a running instance
npm run format         # Prettier
```

Docker image:

```bash
docker build -t astaldoo/tidewiki:latest .
docker buildx build --platform linux/amd64,linux/arm64 -t astaldoo/tidewiki:latest --push .
```

The GitHub workflow in [`.github/workflows/docker.yml`](.github/workflows/docker.yml) does the multi-arch build and push automatically once `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are set as repository secrets.

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Project layout

```
src/
  app/            pages and API routes (Next.js App Router)
  components/     React components (client and server)
  lib/            everything without UI: auth, database, search, Markdown, mail, media, i18n …
  proxy.ts        security headers and CSP nonce for every request
tests/            unit tests (Vitest), end-to-end test, fixtures
scripts/          build helpers
docs/             logo and screenshots
docker.yaml       Compose file for users
Dockerfile        multi-stage image, non-root runtime
```

**Stack:** Next.js 16, React 19, TypeScript, PostgreSQL 17 via node-postgres (pg_trgm for search; better-sqlite3 only for the one-time import of 1.x data), markdown-it + sanitize-html, @node-rs/argon2, nodemailer, Tailwind CSS 4, Inter and JetBrains Mono (self-hosted).

## License

[MIT](LICENSE). Inter and JetBrains Mono are licensed under the SIL Open Font License 1.1.
