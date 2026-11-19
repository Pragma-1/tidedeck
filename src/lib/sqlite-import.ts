import { existsSync, renameSync, rmSync, copyFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";
import { one, run, sql, syncIdentity, tx } from "./db";
import { openLegacySqlite } from "./legacy-sqlite";
import { insertRows, ORDER, TABLES, type Table } from "./backup";
import { rebuildLinks } from "./pages";
import { reindexAll } from "./search";

/*
 * Moving from Tidewiki 1.x (SQLite, one container) to PostgreSQL: when the database is still
 * empty and the data volume holds a wiki.db, everything is copied over once at start-up —
 * pages with history, trash, accounts with passwords and 2FA devices, settings, legal texts,
 * uploads (they stay where they are) and the security log. Sign-ins are not carried over.
 * Afterwards the file is renamed to wiki.db.imported-<date>, so it is never imported twice.
 */

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\u0000/g, "") : v);

export async function importSqliteIfPresent(): Promise<null | Record<Table, number>> {
  const file = path.join(/* turbopackIgnore: true */ DATA_DIR, "wiki.db");
  if (!existsSync(file)) return null;
  const users = (await one<{ n: number }>(sql`SELECT COUNT(*) AS n FROM users`))?.n ?? 0;
  if (users > 0) {
    console.warn("[import] data/wiki.db found, but the PostgreSQL database already has accounts — not imported.");
    return null;
  }
  console.log("[import] Moving data/wiki.db (Tidewiki 1.x) into PostgreSQL …");
  // migrate a copy, so the original stays untouched if anything goes wrong
  const copy = `${file}.import-${Date.now()}`;
  copyFileSync(file, copy);
  for (const ext of ["-wal", "-shm"]) if (existsSync(file + ext)) copyFileSync(file + ext, copy + ext);
  const lite = openLegacySqlite(copy);
  const counts = Object.fromEntries(ORDER.map((t) => [t, 0])) as Record<Table, number>;
  try {
    await tx(async () => {
      const parents: [number, number][] = [];
      for (const t of ORDER) {
        counts[t] = 0;
        const cols = TABLES[t] as readonly string[];
        const have = new Set((lite.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
        if (!have.size) continue;
        const select = cols.map((c) => (have.has(c) ? `"${c}"` : "NULL")).join(", ");
        let batch: unknown[][] = [];
        for (const row of lite.prepare(`SELECT ${select} FROM "${t}"`).raw().iterate() as Iterable<unknown[]>) {
          const r = row.map(clean);
          if (t === "pages" && r[3] !== null) {
            parents.push([r[0] as number, r[3] as number]);
            r[3] = null;
          }
          if (t === "settings" && String(r[0]).startsWith("backup_")) continue;
          batch.push(r);
          counts[t]++;
          if (batch.length >= 200) {
            await insertRows(t, batch);
            batch = [];
          }
        }
        await insertRows(t, batch);
      }
      for (const [id, parent] of parents) await run(sql`UPDATE pages SET parent_id = ${parent} WHERE id = ${id}`);
      for (const t of ["users", "pages", "page_revisions", "trash", "media", "totp_devices", "audit_log"] as const)
        await syncIdentity(t);
      await reindexAll();
    });
    await rebuildLinks();
  } finally {
    lite.close();
    for (const ext of ["", "-wal", "-shm"]) rmSync(copy + ext, { force: true });
  }
  const stamp = new Date().toISOString().slice(0, 10);
  renameSync(file, `${file}.imported-${stamp}`);
  for (const ext of ["-wal", "-shm"])
    if (existsSync(file + ext)) renameSync(file + ext, `${file}.imported-${stamp}${ext}`);
  console.log(
    `[import] Done: ${counts.pages} pages, ${counts.page_revisions} versions, ${counts.users} accounts, ${counts.media} files. ` +
      `The old file is kept as data/wiki.db.imported-${stamp}.`,
  );
  return counts;
}
