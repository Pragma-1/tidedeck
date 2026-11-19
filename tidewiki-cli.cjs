// Emergency tool, run inside the container:
//   docker exec tidewiki node tidewiki-cli.cjs unlock <username|e-mail>
//   docker exec tidewiki node tidewiki-cli.cjs unlock --all
//   docker exec tidewiki node tidewiki-cli.cjs locked
// Uses the same database connection settings as the wiki (WIKI_DB_* or WIKI_DATABASE_URL).
// All values are bound parameters; the argument is never part of the SQL text.
"use strict";
const fs = require("node:fs");
const { Client } = require("pg");

const fileOr = (v, f) => (f ? fs.readFileSync(f, "utf8").trim() : v);
const ssl = (process.env.WIKI_DB_SSL || "off").toLowerCase();
const client = new Client(
  process.env.WIKI_DATABASE_URL
    ? { connectionString: process.env.WIKI_DATABASE_URL }
    : {
        host: process.env.WIKI_DB_HOST || "db",
        port: Number(process.env.WIKI_DB_PORT || 5432),
        database: process.env.WIKI_DB_NAME || "tidewiki",
        user: process.env.WIKI_DB_USER || "tidewiki",
        password: fileOr(process.env.WIKI_DB_PASSWORD, process.env.WIKI_DB_PASSWORD_FILE),
        ssl: ssl === "off" ? false : ssl === "require" ? { rejectUnauthorized: false } : { rejectUnauthorized: true },
      },
);

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (!(cmd === "locked" || (cmd === "unlock" && arg))) {
    console.log("Usage: node tidewiki-cli.cjs locked | unlock <username|e-mail> | unlock --all");
    process.exit(cmd ? 1 : 0);
  }
  await client.connect();
  const now = Math.floor(Date.now() / 1000);
  const audit = (detail, target) =>
    client.query(
      "INSERT INTO audit_log(ts, user_id, event, ip, detail, target_id) VALUES ($1, NULL, 'admin.unlock', NULL, $2, $3)",
      [now, `${detail} (command line)`, target ?? null],
    );
  if (cmd === "locked") {
    const { rows } = await client.query(
      "SELECT l.key, l.locked_until, u.username FROM lockouts l LEFT JOIN users u ON u.id = l.user_id WHERE l.locked_until > $1",
      [now],
    );
    if (!rows.length) console.log("No active lock-outs.");
    for (const r of rows)
      console.log(
        `${r.username ?? r.key.replace(/^fail:id:/, "(unknown name) ")}  locked until ${new Date(Number(r.locked_until) * 1000).toISOString()}`,
      );
  } else if (arg === "--all") {
    const r = await client.query("DELETE FROM lockouts");
    await audit("all lock-outs lifted");
    console.log(`Lifted ${r.rowCount} lock-out entr${r.rowCount === 1 ? "y" : "ies"}.`);
  } else {
    const { rows } = await client.query(
      "SELECT id, username, email FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($1) LIMIT 1",
      [arg],
    );
    const u = rows[0];
    if (!u) {
      console.error(`No account "${arg}".`);
      process.exitCode = 1;
      return;
    }
    await client.query("DELETE FROM lockouts WHERE user_id = $1 OR key = ANY($2::text[])", [
      u.id,
      [`fail:u:${u.id}`, `fail:id:${u.username.toLowerCase()}`, `fail:id:${u.email.toLowerCase()}`],
    ]);
    await audit(u.username, u.id);
    console.log(`${u.username} can sign in again.`);
  }
}

main()
  .catch((e) => {
    console.error(`[tidewiki] ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => client.end().catch(() => {}));
