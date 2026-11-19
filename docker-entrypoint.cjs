// Container entrypoint: honours PUID/PGID (default 1000:1000), fixes ownership of the data
// directory, then permanently drops root before the app starts. If the container was
// started with a non-root user (compose `user:`), it just starts the app.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

function die(msg) {
  console.error(`[tidewiki] ${msg}`);
  process.exit(1);
}

function chownTree(dir, uid, gid) {
  fs.lchownSync(dir, uid, gid);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) chownTree(p, uid, gid);
    else fs.lchownSync(p, uid, gid);
  }
}

if (typeof process.getuid === "function" && process.getuid() === 0) {
  const id = (name) => {
    const raw = (process.env[name] || "").trim() || "1000";
    if (!/^\d{1,9}$/.test(raw)) die(`${name} must be a number, got "${raw}".`);
    return Number(raw);
  };
  const uid = id("PUID"),
    gid = id("PGID");
  if (uid === 0 || gid === 0) die("PUID/PGID 0 (root) is not allowed. Use a normal user id such as 1000.");

  const own = (dir) => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = fs.statSync(dir);
    if (st.uid !== uid || st.gid !== gid) {
      console.log(`[tidewiki] Setting ownership of ${dir} to ${uid}:${gid}`);
      chownTree(dir, uid, gid);
    }
  };
  own(process.env.WIKI_DATA_DIR || "/data");

  // A separate backup folder (another disk, a NAS share). Never a system path: it gets chown -R.
  const bdir = (process.env.WIKI_BACKUP_DIR || "").trim();
  if (bdir) {
    const norm = path.resolve(bdir);
    if (
      !path.isAbsolute(bdir) ||
      norm.split("/").filter(Boolean).length < 1 ||
      /^\/(bin|boot|dev|etc|lib|lib64|proc|root|run|sbin|sys|usr|var|app|tmp)(\/|$)/.test(norm)
    )
      die(`WIKI_BACKUP_DIR must be an absolute path to a dedicated folder such as /backups, got "${bdir}".`);
    try {
      own(norm);
    } catch (e) {
      // e.g. an NFS share with root squashing: the share must already belong to PUID:PGID
      console.warn(
        `[tidewiki] Could not set ownership of ${norm} (${e.code || e.message}); make sure it belongs to ${uid}:${gid}.`,
      );
    }
  }

  process.setgroups([]);
  process.setgid(gid);
  process.setuid(uid);
  try {
    process.setuid(0);
    die("could not drop root privileges");
  } catch (e) {
    if (e.code !== "EPERM") throw e;
  }
  console.log(`[tidewiki] Running as ${process.getuid()}:${process.getgid()}`);
}

require("./server.js");
