import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import pg from "pg";
import { HttpError } from "./validate";

/*
 * PostgreSQL access for the whole app.
 *
 * Queries are written with the `sql` tagged template. Every ${value} becomes a bound parameter
 * ($1, $2, …) — values never become part of the SQL text, so injection is impossible by
 * construction. The only way to put something into the SQL text is a nested `sql` fragment
 * (itself a literal from the source code) or `sql.ident()` with an explicit allow-list.
 *
 *   const page = await one<PageRow>(sql`SELECT * FROM pages WHERE slug = ${slug}`);
 *
 * Transactions run SERIALIZABLE and are retried on serialization failures and deadlocks, so
 * code can be written as if it were alone (as it was with SQLite). Inside `tx(fn)`, every query
 * helper automatically uses the transaction's connection (AsyncLocalStorage).
 */

/* ------------------------------------------------------------------ sql tag */

const RAW = Symbol("raw");
type Raw = { [RAW]: string };

export class Sql {
  constructor(
    readonly strings: readonly string[],
    readonly values: readonly unknown[],
  ) {}
}

/** Tagged template: literal SQL with bound parameters. Refuses anything that isn't a real template literal. */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): Sql {
  // A real tagged template has a frozen `raw` array; a hand-built array (e.g. user input) doesn't.
  if (!Array.isArray(strings) || !Array.isArray((strings as TemplateStringsArray).raw) || !Object.isFrozen(strings))
    throw new Error("sql`` must be used as a tagged template");
  return new Sql(strings, values);
}

/** An identifier (table/column name) — only from an allow-list written in the code. */
sql.ident = (name: string, allowed: readonly string[]): Raw => {
  if (!allowed.includes(name) || !/^[a-z_][a-z0-9_]{0,62}$/.test(name))
    throw new Error(`identifier not allowed: ${name}`);
  return { [RAW]: `"${name}"` };
};
/** Joins fragments with a separator fragment (e.g. sql` AND `). */
sql.join = (parts: readonly Sql[], sep: Sql): Sql => {
  if (!parts.length) return sql``;
  const strings: string[] = [""];
  const values: unknown[] = [];
  parts.forEach((p, i) => {
    if (i > 0) {
      values.push(sep);
      strings.push("");
    }
    values.push(p);
    strings.push("");
  });
  return new Sql(strings, values);
};
sql.empty = new Sql([""], []);

/** Compiles a fragment tree into text with $n placeholders and a flat value list. */
export function compile(q: Sql): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const walk = (f: Sql): string => {
    let text = f.strings[0];
    for (let i = 0; i < f.values.length; i++) {
      const v = f.values[i];
      if (v instanceof Sql) text += walk(v);
      else if (v && typeof v === "object" && RAW in v) text += (v as Raw)[RAW];
      else text += `$${values.push(param(v))}`;
      text += f.strings[i + 1];
    }
    return text;
  };
  return { text: walk(q), values };
}

function param(v: unknown): unknown {
  if (v === undefined) throw new Error("undefined SQL parameter (a bug: pass null explicitly)");
  if (typeof v === "boolean") throw new Error("boolean SQL parameter (store 0/1)");
  if (typeof v === "number" && !Number.isFinite(v)) throw new HttpError(400, "Invalid number.");
  // PostgreSQL text can't hold NUL. Input validation refuses it earlier; this is the last line.
  if (typeof v === "string" && v.includes("\u0000")) throw new HttpError(400, "Text contains invalid characters.");
  if (Array.isArray(v)) v.forEach(param);
  return v;
}

/* ------------------------------------------------------------------- types */

// BIGINT (ids, timestamps, counts) arrives as a string by default; we only store safe integers.
const toInt = (s: string) => {
  const n = Number(s);
  if (!Number.isSafeInteger(n)) throw new Error(`integer out of range: ${s}`);
  return n;
};
pg.types.setTypeParser(pg.types.builtins.INT8, toInt);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (s: string) => Number(s));

/* -------------------------------------------------------------- connection */

/** A whole number from the environment within [min, max], else the default (no NaN reaching the driver). */
function envInt(name: string, def: number, min: number, max: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}

export function dbConfig(): pg.PoolConfig {
  const fileOr = (v?: string, file?: string) => (file ? readFileSync(file, "utf8").trim() : v);
  const url = process.env.WIKI_DATABASE_URL;
  const ssl = (process.env.WIKI_DB_SSL || "off").toLowerCase();
  if (!["off", "require", "verify"].includes(ssl)) throw new Error("WIKI_DB_SSL must be off, require or verify");
  return {
    ...(url
      ? { connectionString: url }
      : {
          host: process.env.WIKI_DB_HOST || "db",
          port: envInt("WIKI_DB_PORT", 5432, 1, 65535),
          database: process.env.WIKI_DB_NAME || "tidewiki",
          user: process.env.WIKI_DB_USER || "tidewiki",
          password: fileOr(process.env.WIKI_DB_PASSWORD, process.env.WIKI_DB_PASSWORD_FILE),
        }),
    ssl: ssl === "off" ? false : ssl === "require" ? { rejectUnauthorized: false } : { rejectUnauthorized: true },
    max: envInt("WIKI_DB_POOL", 10, 1, 100),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: "tidewiki",
    // a runaway query can't hold a connection forever
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 60_000,
  };
}

type Store = { client: pg.PoolClient; done: boolean; after: (() => void)[] };
const g = globalThis as unknown as { __wikiPool?: pg.Pool; __wikiReady?: Promise<void> | null };
const als = new AsyncLocalStorage<Store>();

export function pool(): pg.Pool {
  if (!g.__wikiPool) {
    g.__wikiPool = new pg.Pool(dbConfig());
    // an idle connection dying (database restart) must not crash the process
    g.__wikiPool.on("error", (e) => console.error("[db] idle connection lost:", e.message));
  }
  return g.__wikiPool;
}

export async function closePool() {
  const p = g.__wikiPool;
  g.__wikiPool = undefined;
  g.__wikiReady = null;
  if (p) await p.end();
}

/** Schema up to date? Runs the migrations once per process (retrying while the database starts). */
export function ready(): Promise<void> {
  // `next build` has no database; anything that tries is a page that should be dynamic
  if (process.env.NEXT_PHASE === "phase-production-build")
    return Promise.reject(new Error("No database during the build (make this page dynamic)."));
  if (!g.__wikiReady)
    g.__wikiReady = (async () => {
      const { migrate } = await import("./schema");
      for (let attempt = 0; ; attempt++) {
        try {
          await migrate();
          return;
        } catch (e) {
          const code = (e as { code?: string }).code ?? "";
          const transient = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "57P03", "ETIMEDOUT"].includes(code);
          if (!transient || attempt >= 30) throw e;
          if (attempt === 0) console.log("[db] waiting for the database …");
          await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 5000)));
        }
      }
    })().catch((e) => {
      g.__wikiReady = null; // the next request tries again
      throw e;
    });
  return g.__wikiReady;
}

/* ------------------------------------------------------------------ queries */

async function exec<T extends pg.QueryResultRow>(q: Sql, raw = false): Promise<pg.QueryResult<T>> {
  const { text, values } = compile(q);
  const store = als.getStore();
  if (store && !store.done) return store.client.query<T>(text, values);
  if (!raw) await ready();
  return pool().query<T>(text, values);
}

/** All rows. */
export async function all<T extends pg.QueryResultRow = Record<string, unknown>>(q: Sql): Promise<T[]> {
  return (await exec<T>(q)).rows;
}
/** First row or undefined. */
export async function one<T extends pg.QueryResultRow = Record<string, unknown>>(q: Sql): Promise<T | undefined> {
  return (await exec<T>(q)).rows[0];
}
/** First column of the first row. */
export async function val<T = unknown>(q: Sql): Promise<T | undefined> {
  const r = await exec(q);
  const row = r.rows[0];
  return row ? (Object.values(row)[0] as T) : undefined;
}
/** Statement without result rows; returns the number of affected rows. */
export async function run(q: Sql): Promise<number> {
  return (await exec(q)).rowCount ?? 0;
}
/** Only for the migrator: runs before the schema is ready. */
export async function execRaw(q: Sql) {
  return exec(q, true);
}

const RETRY = new Set(["40001", "40P01"]); // serialization_failure, deadlock_detected

/**
 * Runs fn in one transaction (SERIALIZABLE, retried on conflicts). Nested calls join the outer
 * transaction. fn may run more than once — keep side effects (events, mails) after it returns.
 */
export async function tx<T>(fn: () => Promise<T>, opts: { readOnly?: boolean } = {}): Promise<T> {
  const outer = als.getStore();
  if (outer && !outer.done) return fn();
  await ready();
  for (let attempt = 0; ; attempt++) {
    const client = await pool().connect();
    const store: Store = { client, done: false, after: [] };
    let broken = false;
    try {
      // read-only + deferrable: waits for a safe snapshot, then can never fail with a conflict
      await client.query(`BEGIN ISOLATION LEVEL SERIALIZABLE${opts.readOnly ? " READ ONLY DEFERRABLE" : ""}`);
      const result = await als.run(store, fn);
      await client.query("COMMIT");
      store.done = true;
      for (const f of store.after)
        try {
          f();
        } catch (e) {
          console.error("[db] after-commit hook:", e instanceof Error ? e.message : e);
        }
      return result;
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        broken = true;
      }
      if (RETRY.has((e as { code?: string }).code ?? "") && attempt < 10) {
        await new Promise((r) => setTimeout(r, 5 + Math.random() * 20 * (attempt + 1)));
        continue;
      }
      throw e;
    } finally {
      // anything scheduled inside fn that runs later must not use this connection any more
      store.done = true;
      client.release(broken);
    }
  }
}

/** Runs fn after the current transaction commits (dropped on rollback/retry); immediately outside one. */
export function afterCommit(fn: () => void) {
  const s = als.getStore();
  if (s && !s.done) s.after.push(fn);
  else fn();
}

/** True inside a transaction (for code that must not start background work there). */
export const inTx = () => {
  const s = als.getStore();
  return !!s && !s.done;
};

/** After inserting rows with explicit ids, moves the identity sequence past them. */
export async function syncIdentity(
  table: "users" | "pages" | "page_revisions" | "trash" | "media" | "totp_devices" | "audit_log",
) {
  const t = sql.ident(table, ["users", "pages", "page_revisions", "trash", "media", "totp_devices", "audit_log"]);
  await run(
    sql`SELECT setval(pg_get_serial_sequence(${table}, 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${t}), 1), (SELECT COUNT(*) > 0 FROM ${t}))`,
  );
}

const VACUUMABLE = [
  "users",
  "audit_log",
  "sessions",
  "lockouts",
  "rate_limits",
  "totp_devices",
  "reset_tokens",
  "trash",
  "trash_revisions",
  "pages",
  "page_revisions",
  "page_links",
  "search_idx",
  "search_dirty",
  "media",
] as const;
export type WipeTable = (typeof VACUUMABLE)[number];

const WIPE_KEY = "wipe_pending";
const gw = globalThis as unknown as {
  __wikiWipe?: Promise<void>;
  __wikiWipeRetry?: { timer: ReturnType<typeof setTimeout> | null; attempt: number };
};
/** Seconds until the next try when rows couldn't be removed yet; after that the hourly job. */
const WIPE_RETRY_S = [30, 120, 600];

/**
 * Removes deleted rows from the database files for good, after an erasure, a final deletion or
 * a deleted file. A DELETE only marks a row dead, and a plain VACUUM only marks its space as
 * reusable — the old bytes stay in the table file until something overwrites them (checked in
 * tests/wipe.test.ts). VACUUM FULL writes the table into a new file and removes the old one.
 *
 * VACUUM FULL keeps deleted rows that an older snapshot could still see — a backup that is
 * running, a slow request, PostgreSQL's own ANALYZE. It says so ("N dead row versions cannot be
 * removed yet"); then the table stays on the list and is tried again shortly (30 s, 2 min,
 * 10 min, then hourly), so "succeeded" really means the rows are gone.
 *
 * It needs the table to itself for a moment. So it waits at most 2 s for that (readers queue
 * behind it meanwhile) and otherwise leaves the table on a persistent to-do list that the hourly
 * job (and the next wipe) works through — nothing is forgotten across restarts. Runs one at a
 * time, after the surrounding transaction, and never fails the request.
 */
export function wipe(tables: readonly WipeTable[]): Promise<void> {
  if (inTx()) {
    const list = [...tables];
    afterCommit(() => void wipe(list));
    return Promise.resolve();
  }
  const run = async () => {
    const todo = new Set<WipeTable>(tables);
    try {
      const r = await pool().query<{ value: string }>("SELECT value FROM settings WHERE key = $1", [WIPE_KEY]);
      for (const t of JSON.parse(r.rows[0]?.value ?? "[]") as unknown[])
        if ((VACUUMABLE as readonly unknown[]).includes(t)) todo.add(t as WipeTable);
    } catch {
      /* no list yet */
    }
    const left: WipeTable[] = [];
    for (const t of todo) {
      const c = await pool().connect();
      // VERBOSE reports "<n> dead row versions cannot be removed yet" as the detail of an INFO
      // message; the number comes first in every language PostgreSQL speaks
      let kept = 0;
      const onNotice = (n: { detail?: string }) => {
        const m = /^(\d+)\D/.exec(n.detail ?? "");
        if (m) kept = Math.max(kept, Number(m[1]));
      };
      c.on("notice", onNotice);
      try {
        await c.query("SET lock_timeout = '2s'");
        await c.query("SET statement_timeout = '15min'");
        await c.query(compile(sql`VACUUM (FULL, VERBOSE) ${sql.ident(t, VACUUMABLE)}`).text);
        if (kept > 0) left.push(t);
        await c.query(compile(sql`ANALYZE ${sql.ident(t, VACUUMABLE)}`).text);
      } catch (e) {
        if (!left.includes(t)) left.push(t);
        if (pgCode(e) !== "55P03") console.error("[db] wipe:", t, e instanceof Error ? e.message : e);
      } finally {
        c.off("notice", onNotice);
        await c.query("RESET lock_timeout; RESET statement_timeout").catch(() => {});
        c.release();
      }
    }
    try {
      if (left.length)
        await pool().query(
          "INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
          [WIPE_KEY, JSON.stringify(left)],
        );
      else await pool().query("DELETE FROM settings WHERE key = $1", [WIPE_KEY]);
    } catch (e) {
      console.error("[db] wipe list:", e instanceof Error ? e.message : e);
    }
    // not everything could be removed yet: try again soon, a few times, before the hourly job
    const r = (gw.__wikiWipeRetry ??= { timer: null, attempt: 0 });
    if (!left.length) r.attempt = 0;
    else if (!r.timer && r.attempt < WIPE_RETRY_S.length) {
      r.timer = setTimeout(() => {
        r.timer = null;
        void wipe([]);
      }, WIPE_RETRY_S[r.attempt++] * 1000);
      r.timer.unref?.();
    }
  };
  const next = (gw.__wikiWipe ?? Promise.resolve()).then(run, run);
  gw.__wikiWipe = next;
  return next;
}

/** Tables still waiting for a wipe (for the hourly job and the tests). */
export async function pendingWipes(): Promise<WipeTable[]> {
  const r = await pool().query<{ value: string }>("SELECT value FROM settings WHERE key = $1", [WIPE_KEY]);
  return r.rows[0] ? (JSON.parse(r.rows[0].value) as WipeTable[]) : [];
}

/** PostgreSQL error code, if any (23505 = unique violation, …). */
export const pgCode = (e: unknown) =>
  e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";

export const now = () => Math.floor(Date.now() / 1000);
