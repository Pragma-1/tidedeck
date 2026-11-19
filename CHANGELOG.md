# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

The next release is **2.0.0**: it changes the database and the deployment. See _Upgrading_ below.

### Changed — breaking

- **PostgreSQL instead of SQLite.** The database runs in its own container (`postgres:17-alpine`) on an internal network with no published port. Name, user, password and data folder are set in `.env` (`DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_ADMIN_USER`, `DB_ADMIN_PASSWORD`, `DB_DATA`). The wiki connects as its own user without superuser rights, which owns only its database; the superuser password stays in the database container. An existing PostgreSQL server can be used instead (`WIKI_DB_*`, `WIKI_DATABASE_URL`, `WIKI_DB_SSL`).
- `docker.yaml` now has two services and needs Docker Compose 2.23 or newer.
- Backups use a new, encrypted format. Backups made by earlier pre-release builds (SQLite files) can't be restored by this version.

### Upgrading to 2.0.0

1. Keep a copy of your master key (`data/master.key` or `WIKI_MASTER_KEY`) and of the `data` folder.
2. Replace `docker.yaml` with the new one and add `DB_PASSWORD` and `DB_ADMIN_PASSWORD` to `.env` (see `.env.example`).
3. `docker compose -f docker.yaml pull && docker compose -f docker.yaml up -d`.

On its first start against the empty database the wiki imports `data/wiki.db` once — pages with history, trash, accounts with their 2FA devices, settings, legal texts, the security log, uploads stay where they are — and renames it to `wiki.db.imported-<date>`. Everyone has to sign in again. Make a fresh backup afterwards.

### Added

- **Media: delete several at once, delete all unused.** _Einstellungen → Medien_ has checkboxes (shift-click for a range) and _Unbenutzte löschen_ — every file that no page and no page in the trash shows, plus stray files on disk without an entry. The list now also says when a file is only shown in the trash or only in older versions, and the confirmation spells out what will then be missing. API: `DELETE /api/media` with `{ ids }`, `POST /api/media/unused`.
- **Privacy notice can be switched off** like terms and imprint — for when it is published elsewhere: enter its https address and the footer, sign-up form, legal pages and video notes link there; without an address there's no link at all.
- **Delete several pages at once.** _Seiten verwalten_ (sidebar, editors and up) lists every page as a tree with checkboxes: ticking a chapter ticks its sub-pages, shift-click selects a range, a filter narrows the list. The selection goes to the trash in one step — sub-pages first, so a chapter and its sub-pages come back together; sub-pages that weren't selected move to the top level. Editors delete their own pages, administrators any; one page that isn't allowed and nothing is deleted. API: `DELETE /api/pages` with `{ slugs }` (at most 500).
- **Arrange an import.** The import preview is now an editable tree: reorder pages, make them main pages or sub-pages (one level up / sub-page of the page above), move them to any chapter of the import or under an existing wiki page, rename them, or leave them out (their sub-pages move up a level). The nesting limit is shown and enforced. The previewed file is kept on the server for an hour for the person who uploaded it, so it isn't uploaded twice (`POST /api/import/apply` with `{ token, conflict, layout }`).
- **Trash.** Deleting a page moves it with its whole history to the trash for 30 days (then it is removed for good by the hourly job). Visible to editors and up, with a preview; editors restore, administrators purge single pages or empty it. A restore keeps the old address if it is free, the old chapter if it still exists, and pulls former sub-pages back under it.
- **Versions.** Optional edit summary when saving; per-version view, compare with current, `.md` download and restore in _Verlauf_. A restore is done on the server and creates a new version that records where it came from. Long histories are paged.
- **Backups.** Scheduled and manual backups, a safety backup before every full restore and import, download and upload.
  - **Encrypted** with AES-256-GCM before they leave the wiki (keys derived from the master key, authenticated in 64 KiB chunks, file names that reveal nothing). The storage only ever sees ciphertext; tampered, swapped or truncated files are refused.
  - **Storage:** a folder (local disk, or an NFS/SMB share mounted as a Docker volume — examples in `docker.yaml`) or **S3-compatible storage**, set up by the owner in the wiki and tested before it is saved. The S3 secret is stored encrypted.
  - **Granular restore:** open a backup and restore a single page (as a new version, or recreated with its history and pictures if it was deleted) or a single deleted account (its pages are linked to it again) — or everything.
  - **Permissions:** administrators list, create, check and open backups and restore pages and editor/viewer accounts; restoring an administrator, a full restore (with password), download, upload, delete and the storage location are owner-only.
  - **On/off:** one switch in _Einstellungen → Sicherungen_. Off: no automatic backups and no _Jetzt sichern_ (only the safety copy before a full restore or import is still made); existing backups stay and can be opened and restored.
  - **Folder in the settings:** the owner can pick the backup folder (e.g. a NAS share mounted under `/mnt`) — only inside `WIKI_BACKUP_ROOTS` (default `/backups`, `/mnt`, `/media`, `/srv`), only existing folders, no links, never system folders or the wiki's data; tested before saving, never created on the fly.
  - Uploads are deduplicated across backups; old automatic backups and safety backups are pruned.
- Privacy notice and personal-data export cover the trash and backups.
- Terms of use and imprint can be switched off in _Einstellungen → Rechtliches_, for private wikis. The privacy notice always stays. Without an imprint, the postal address is no longer required.
- When the wiki is served through Cloudflare (tunnel or proxy, detected from the `CF-Ray` header), the privacy notice explains what Cloudflare processes, that TLS ends at Cloudflare, its cookies (`__cf_bm`, `cf_clearance`, `_cfuvid`) and the transfer basis (EU-US Data Privacy Framework plus standard contractual clauses). No setting needed.
- `tests/attack.mjs`: the adversarial test battery against any running instance.

### Security

- **Deleted data is really gone from the database files.** Erasing an account, deleting a page for good and deleting a file now rewrite the affected tables (`VACUUM FULL`); before, a plain `VACUUM` left the deleted text in PostgreSQL's files until overwritten (a new test reads the raw files). A busy table is retried from a persistent list, so a wipe is never forgotten. If an older snapshot (a running backup, a slow request, PostgreSQL's own ANALYZE) still keeps deleted rows alive, PostgreSQL says so and the wipe is repeated after 30 s, 2 min and 10 min, then hourly — it only counts as done once the rows are really gone. Expired IP addresses and log entries get the same treatment.
- Deleted uploads were already removed from disk; now files a crash left without an entry and abandoned partial uploads are removed too (hourly and with _Unbenutzte löschen_).
- Next.js 16.4.6 (fixes GHSA-mfr8-8qww-v76h and GHSA-vc7v-qv4w-wrv8; Tidewiki doesn't use the affected `use cache`, so it wasn't exposed).
- Moving a page now checks the depth of its sub-pages too, so they can't end up nested deeper than allowed.
- The import arrangement from the browser is checked completely on the server: every page exactly once, chapters only from the archive or existing pages, no loops, the nesting limit; a preview token is bound to the admin who made it.
- Every database query goes through a tagged template that only accepts bound parameters; identifiers only from allow-lists; a test fails on any raw query. SQL-injection payloads are part of the test suites and the fuzzer.
- Transactions are `SERIALIZABLE` with retry, so concurrent requests can't create two owners, double-use an MFA attempt or lose an update. Statement and idle-transaction timeouts.
- Database errors reach the browser only as generic messages (409 for conflicts, 400 for invalid data, 503 when the database is busy or unreachable).
- An account its owner erased themselves can't come back from a backup — neither restored singly nor by a full restore.
- The S3 endpoint and access key are visible only to the owner, not to other administrators.
- The wiki never follows a symbolic link inside a backup folder, so write access to a NAS share isn't a way to read or overwrite files elsewhere.
- S3 connections are pinned to the resolved address and refuse link-local, metadata and similar addresses; a backup folder prefix can't contain `..`.

### Fixed

- The _Datenschutz_ panel under _Rechtliches_ started below the tall _Betreiber_ panel instead of right under the page switches. Settings panels now fill two independent columns.
- The list of legal texts didn't follow the switches until the page was reloaded.
- Selected text in warning and danger boxes (and in marked text) was hard to see — the see-through blue turned a dull grey on the beige/pink background, so marking text looked like it didn't work. Selections there are now a solid blue in both themes.
- The legal-text and media-library API responses spread an unresolved promise into the response (found by the new type-aware lint).
- Decrypting a backup whose last chunk was exactly full size failed.
- Building the image no longer tries to reach the database.
- Uploads and imports left one `error` listener on the file stream per backpressure cycle (thousands on a large video or import). The listeners are now removed after each wait.

## [1.0.0] — 2026-11-03

First public release.

### Reading and writing

- Markdown pages in chapters with live preview, drafts, live updates for readers, conflict detection, history with diff and restore, recent changes, backlinks.
- Search while typing with a full results page; substring matching, `*` wildcards, phrases, case- and accent-insensitive.
- Links to other sites open in a new tab; picture-in-picture for every video.
- Images and videos by upload, paste or drag & drop; two-click YouTube/Vimeo embeds.
- Import and export of single pages and the whole wiki; new pages from a `.md` file.
- One typeface throughout (Inter), monospace only for code.

### Accounts and administration

- Roles (owner, administrator, editor, viewer), self-registration, public read-only or private mode.
- Two-factor authentication with several devices per account, required per role.
- Password policy, escalating lock-out, session overview with sign-out per device, self-service profile changes.
- SMTP in the settings with a test mail; HTML mails in the wiki's design.
- Security log with IDs, filters and export; GDPR export and erasure; generated legal pages.
- Confirmation dialogs for destructive actions.

### Upgrading from pre-release builds

The database migrates automatically: the existing authenticator becomes a device named "Authenticator", a former "2FA required for everyone" setting turns into "required" for all three roles, and an unedited Markdown guide is replaced by the current one.

[Unreleased]: ../../compare/v1.0.0...HEAD
[1.0.0]: ../../releases/tag/v1.0.0
