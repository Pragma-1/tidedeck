export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  (await import("./lib/process-safety")).installSafetyNet();
  const { loadMasterKey } = await import("./lib/crypto");
  loadMasterKey(); // fail fast on a bad key instead of at first login
  // Database schema first (waits for PostgreSQL to accept connections), then a one-time move
  // of a Tidewiki 1.x wiki.db, if there is one.
  const { ready } = await import("./lib/db");
  await ready();
  const { importSqliteIfPresent } = await import("./lib/sqlite-import");
  await importSqliteIfPresent();
  const { syncSystemPages } = await import("./lib/seed");
  await syncSystemPages("de"); // built-in pages follow the site language while unedited
  const { startRetentionJob } = await import("./lib/retention");
  startRetentionJob(); // GDPR storage limitation for logs, IPs, sessions; 30-day trash
  const { startBackupJob } = await import("./lib/backup");
  startBackupJob(); // scheduled encrypted backups (Settings → Backups)
  const { ensureSetupToken } = await import("./lib/auth");
  const token = await ensureSetupToken();
  if (token) {
    console.log("\n[tidewiki] No administrator exists yet.");
    console.log(`[tidewiki] Open /setup and enter this one-time setup token: ${token}\n`);
  }
}
