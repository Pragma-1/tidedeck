// A throw-away PostgreSQL cluster for tests: initdb into a temp folder, start on a free port,
// one unprivileged application role (like production), one database per test file.
// Uses the PostgreSQL binaries installed on the machine (PG_BIN, pg_config, or /usr/lib/postgresql).
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, chownSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";

export const APP_ROLE = "tidewiki_app";

function binDir() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const base = "/usr/lib/postgresql";
  if (existsSync(base)) {
    const v = readdirSync(base)
      .filter((d) => /^\d+$/.test(d))
      .sort((a, b) => Number(b) - Number(a))[0];
    if (v) return path.join(base, v, "bin");
  }
  try {
    return execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("PostgreSQL binaries not found. Install PostgreSQL or set PG_BIN.");
  }
}

const freePort = () =>
  new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
    s.on("error", rej);
  });

/** Runs a PostgreSQL tool; as root it runs as the "postgres" system user (initdb refuses root). */
function tool(name, args) {
  const bin = path.join(binDir(), name);
  const asRoot = process.getuid?.() === 0;
  const r = asRoot
    ? spawnSync("runuser", ["-u", "postgres", "--", bin, ...args], { encoding: "utf8" })
    : spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${name} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

export async function startCluster() {
  const root = mkdtempSync(path.join(tmpdir(), "tw-pg-"));
  const data = path.join(root, "data");
  const superPw = randomBytes(18).toString("hex");
  const appPw = randomBytes(18).toString("hex");
  if (process.getuid?.() === 0) {
    const id = execFileSync("id", ["-u", "postgres"], { encoding: "utf8" }).trim();
    const gid = execFileSync("id", ["-g", "postgres"], { encoding: "utf8" }).trim();
    chownSync(root, Number(id), Number(gid));
  }
  chmodSync(root, 0o777);
  const pwfile = path.join(root, "pw");
  writeFileSync(pwfile, superPw, { mode: 0o644 });
  tool("initdb", [
    "-D",
    data,
    "-U",
    "postgres",
    "--pwfile",
    pwfile,
    "--auth=scram-sha-256",
    "-E",
    "UTF8",
    "--locale=C.UTF-8",
  ]);
  rmSync(pwfile);
  const port = await freePort();
  tool("pg_ctl", [
    "-D",
    data,
    "-l",
    path.join(root, "log"),
    "-w",
    "-o",
    `-p ${port} -k ${root} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=300`,
    "start",
  ]);
  const cluster = { root, data, port, superPw, appPw, host: "127.0.0.1" };
  await withSuper(cluster, "postgres", async (c) => {
    await c.query(
      `CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${appPw}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`,
    );
  });
  return cluster;
}

export async function withSuper(cluster, database, fn) {
  const c = new pg.Client({
    host: cluster.host,
    port: cluster.port,
    user: "postgres",
    password: cluster.superPw,
    database,
  });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** A fresh database owned by the app role, set up like the production init script does. */
export async function createDatabase(cluster, name = `tw_${randomBytes(6).toString("hex")}`) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error("bad database name");
  await withSuper(cluster, "postgres", (c) => c.query(`CREATE DATABASE ${name} OWNER ${APP_ROLE}`));
  await withSuper(cluster, name, async (c) => {
    await c.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    await c.query(`REVOKE ALL ON DATABASE ${name} FROM PUBLIC`);
  });
  return name;
}

/** Environment for the app to connect to `database` as the unprivileged role. */
export const appEnv = (cluster, database) => ({
  WIKI_DB_HOST: cluster.host,
  WIKI_DB_PORT: String(cluster.port),
  WIKI_DB_NAME: database,
  WIKI_DB_USER: APP_ROLE,
  WIKI_DB_PASSWORD: cluster.appPw,
});

export function stopCluster(cluster) {
  try {
    tool("pg_ctl", ["-D", cluster.data, "-m", "immediate", "-w", "stop"]);
  } catch {
    /* already down */
  }
  rmSync(cluster.root, { recursive: true, force: true });
}
