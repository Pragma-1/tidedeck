// Test-only helper: the old `db().prepare(sql).get/all/run(...)` call shape on top of PostgreSQL,
// with "?" placeholders. Test SQL is constant text; app code uses the `sql` tagged template instead.
import { pool, ready } from "@/lib/db";

const conv = (s: string) => {
  let i = 0;
  return s.replace(/\?/g, () => `$${++i}`);
};
async function q(text: string, args: unknown[]) {
  await ready();
  return pool().query(conv(text), args);
}
export const db = () => ({
  prepare: (text: string) => ({
    get: async (...a: unknown[]) => (await q(text, a)).rows[0] as Record<string, unknown> | undefined,
    all: async (...a: unknown[]) => (await q(text, a)).rows as Record<string, unknown>[],
    run: async (...a: unknown[]) => ({ changes: (await q(text, a)).rowCount ?? 0 }),
  }),
});

/** Inserts a bare account (no password login) and returns its id. */
export async function addUser(name: string, role: "admin" | "editor" | "viewer" = "admin", owner = 0) {
  await ready();
  const t = Math.floor(Date.now() / 1000);
  const r = await pool().query(
    "INSERT INTO users(username,email,password_hash,role,created_at,password_changed_at,is_owner) VALUES($1,$2,'x',$3,$4,$4,$5) RETURNING id",
    [name, `${name}@example.com`, role, t, owner],
  );
  return Number(r.rows[0].id);
}
