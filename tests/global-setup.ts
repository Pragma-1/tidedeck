// Starts one PostgreSQL cluster for the whole test run; each test file creates its own database.
import { startCluster, stopCluster } from "./pg-cluster.mjs";

export default async function setup() {
  const cluster = await startCluster();
  process.env.TW_PG_CLUSTER = JSON.stringify(cluster);
  return () => stopCluster(cluster);
}
