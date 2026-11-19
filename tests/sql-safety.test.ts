import "./setup-env";
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { compile, one, sql } from "@/lib/db";

/*
 * SQL injection is ruled out by construction: app code only talks to PostgreSQL through the
 * `sql` tagged template (values → bound parameters). These checks keep it that way:
 *  - nothing outside lib/db.ts and lib/schema.ts sends raw query text;
 *  - the tag refuses anything that isn't a real template literal;
 *  - identifiers can only come from allow-lists in the code.
 */

const SRC = path.resolve(import.meta.dirname, "../src");
const files = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = path.join(d, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
const rel = (p: string) => path.relative(SRC, p);

describe("SQL safety", () => {
  const all = files(SRC).map((f) => ({ f: rel(f), s: readFileSync(f, "utf8") }));

  it("only the data layer sends raw SQL text", () => {
    const offenders = all
      .filter(({ f, s }) => /\.query\s*[<(]/.test(s) && !["lib/db.ts", "lib/schema.ts"].includes(f))
      .map((x) => x.f);
    expect(offenders).toEqual([]);
    // the legacy SQLite reader is the only other place with SQL text, and it only uses constant names
    const sqlite = all.filter(({ s }) => /\.prepare\(/.test(s)).map((x) => x.f);
    expect(sqlite.sort()).toEqual(["lib/sqlite-import.ts"]);
    expect(all.filter(({ s, f }) => /new Sql\(/.test(s) && f !== "lib/db.ts").map((x) => x.f)).toEqual([]);
  });

  it("sql.ident is only ever given an allow-list from the code", () => {
    for (const { f, s } of all)
      for (const m of s.matchAll(/sql\.ident\(([^,\n`]+),\s*([^)\n]+)\)/g))
        expect(m[2].trim(), `${f}: ${m[0]}`).toMatch(/^(\[.*\]|[A-Z_]+|\[\.\.\.ORDER, \.\.\.ALL_COLUMNS\])$/);
  });

  it("the tag binds values and refuses everything else", async () => {
    const evil = "x'); DROP TABLE users; --";
    const q = compile(sql`SELECT ${evil} AS v, ${42} AS n`);
    expect(q.text).toBe("SELECT $1 AS v, $2 AS n");
    expect(q.values).toEqual([evil, 42]);
    expect(await one(sql`SELECT ${evil}::text AS v`)).toEqual({ v: evil });
    expect(await one(sql`SELECT 1 AS n FROM users WHERE username = ${evil}`)).toBeUndefined();
    expect(() => (sql as unknown as (a: string[]) => unknown)(["DROP TABLE users"])).toThrow(/tagged template/);
    const fake = Object.assign(["DROP TABLE users"], { raw: ["DROP TABLE users"] });
    expect(() => (sql as unknown as (a: string[]) => unknown)(fake)).toThrow(/tagged template/); // not frozen
    expect(() => sql.ident("users; DROP TABLE x", ["users"])).toThrow();
    expect(() => sql.ident("pages", ["users"])).toThrow();
    expect(() => compile(sql`SELECT ${undefined}`)).toThrow(/undefined/);
    expect(() => compile(sql`SELECT ${true}`)).toThrow(/boolean/);
    expect(() => compile(sql`SELECT ${"a\u0000b"}`)).toThrow(/invalid characters/);
    expect(() => compile(sql`SELECT ${Number.NaN}`)).toThrow();
    // nested fragments keep their own parameters
    const inner = sql`id = ${7}`;
    expect(compile(sql`SELECT 1 WHERE ${inner} AND name = ${"n"}`)).toEqual({
      text: "SELECT 1 WHERE id = $1 AND name = $2",
      values: [7, "n"],
    });
  });

  it("the app connects without superuser rights", async () => {
    const r = await one<{ su: boolean; createrole: boolean; createdb: boolean }>(
      sql`SELECT rolsuper AS su, rolcreaterole AS createrole, rolcreatedb AS createdb FROM pg_roles WHERE rolname = current_user`,
    );
    expect(r).toEqual({ su: false, createrole: false, createdb: false });
    await expect(one(sql`COPY (SELECT 1) TO PROGRAM 'id'`)).rejects.toThrow(); // what a superuser could do
    await expect(one(sql`SELECT pg_read_file('/etc/passwd')`)).rejects.toThrow();
  });
});
