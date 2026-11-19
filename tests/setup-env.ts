import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { appEnv, createDatabase } from "./pg-cluster.mjs";

// Own data folder and own database per test file, connected as the unprivileged app role.
process.env.WIKI_DATA_DIR = mkdtempSync(path.join(tmpdir(), "tidewiki-test-"));
const raw = process.env.TW_PG_CLUSTER;
if (!raw) throw new Error("TW_PG_CLUSTER missing: run the tests through vitest (global setup starts PostgreSQL).");
const cluster = JSON.parse(raw);
Object.assign(process.env, appEnv(cluster, await createDatabase(cluster)));
