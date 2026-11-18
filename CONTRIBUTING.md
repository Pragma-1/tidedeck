# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Before you start

- **Security issues** go through private reporting, not issues — see [SECURITY.md](SECURITY.md).
- For larger changes, open an issue first so we can agree on the approach before you spend time on it.
- New blocks that talk to other services (Sonarr, Pi-hole, Proxmox …) are welcome, but they need to keep the server's rule: it only ever contacts addresses the admin saved, with size limits and timeouts on everything it reads.

## Setup

You need Node.js 22.

```bash
npm ci
npm run dev
```

Open http://localhost:3000 and click **Edit** — the setup code is printed in the terminal. Data goes to `./data` (`DATA_DIR` changes that).

## Checks

Run these before opening a pull request; CI runs the same.

```bash
npm run check    # TypeScript
npm run build    # production build
```

To try the weather sources without real keys, point the server at a local stand-in: `TIDEDECK_WEATHER_TEST_ORIGIN=http://127.0.0.1:4777` sends every weather request to `<origin>/<source>/…` (e.g. `/google/v1/currentConditions:lookup`) instead of the real hosts. Never set it in production.

## Conventions

- **Stack:** Next.js App Router, TypeScript, Tailwind CSS 4, Radix UI (`radix-ui`), lucide-react. File names are kebab-case.
- **Data:** everything the dashboard stores is described in `lib/schema.ts` (zod). A new setting needs a default there, so older files keep loading. Breaking layout changes go through `migrate()`.
- **Server input:** never trust the browser. Validate with the schema, read bodies with `readBody`/`readJson` (size limits), use `isTrustedMutation` for anything that changes data.
- **Interface texts:** plain English, sentence case, written from the user's side ("Open on top of the dashboard", not "target: overlay"). Buttons say what happens.
- **Design:** Tidedeck shares its look with Tidewiki — use the existing tokens (`--brand`, `--band-*`, `tide-corners`) rather than new colours.
