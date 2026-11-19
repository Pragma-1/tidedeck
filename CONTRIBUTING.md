# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Before you start

- **Security issues** go through private reporting, not issues — see [SECURITY.md](SECURITY.md).
- For larger changes, open an issue first so we can agree on the approach before you spend time on it.

## Setup

You need Node.js 22 and PostgreSQL (15 or newer). For development, a container is easiest:

```bash
npm ci
docker run -d --name tw-dev-db -p 127.0.0.1:5432:5432 -e POSTGRES_DB=tidewiki \
  -e POSTGRES_USER=tidewiki -e POSTGRES_PASSWORD=dev postgres:17-alpine
WIKI_DATA_DIR=./data WIKI_DB_HOST=127.0.0.1 WIKI_DB_PASSWORD=dev npm run dev
```

The tests don't use that server: they start a throw-away cluster from the PostgreSQL binaries on the machine (found in `/usr/lib/postgresql/<n>/bin` or via `pg_config`; set `PG_BIN` otherwise) and connect as an unprivileged role, like production.

Open http://localhost:3000/setup — the setup token is printed in the terminal.

## Checks

Run these before opening a pull request; CI runs the same.

```bash
npm run check       # TypeScript, ESLint, Prettier, unit tests
npm run build       # production build
npm run test:e2e    # end-to-end against the built server
```

## Conventions

- **Formatting:** Prettier (`npm run format`). The editor settings are in `.editorconfig`.
- **Interface texts:** written in English in the code and translated in `src/lib/i18n-de.ts`. Use `t("…")` in components and `msg("…")` for strings defined outside a component. A unit test fails if any text has no German translation; placeholders like `{name}` must match.
- **Server errors:** throw `HttpError(status, "English message", field?)`; the API layer translates it.
- **Database access:** only through the `sql` tagged template from `src/lib/db.ts` (`all`, `one`, `val`, `run`, `tx`). Never build SQL from strings; identifiers go through `sql.ident(name, allowList)`. `tests/sql-safety.test.ts` enforces this.
- **Database changes:** add a new migration step in `src/lib/schema.ts` and bump `SCHEMA_VERSION`. Never edit a migration that has shipped. Add an upgrade test in `tests/upgrade.test.ts`. A new table must also be added to the backup table list.
- **Security-relevant code** (auth, sessions, uploads, rendering, import, mail) needs tests for the abuse case, not only the happy path.
- **No new runtime dependencies** without a good reason; pin exact versions.

## Commits and pull requests

- Small, focused commits with a message that says what and why.
- Describe user-visible changes in the pull request and add them to [CHANGELOG.md](CHANGELOG.md) under _Unreleased_.
- Screenshots help for anything visual.
