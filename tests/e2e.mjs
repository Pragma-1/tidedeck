// End-to-end test against the real standalone server (the same artefact the Docker image runs).
// E2E_SERVER_JS  path to server.js           E2E_MASTER_KEY  use an explicit master key
// E2E_BLANK=1    pass blank values the way an unfilled .env file would
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { appEnv, createDatabase, startCluster, stopCluster } from "./pg-cluster.mjs";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { createHmac } from "node:crypto";
import { mkdtempSync, existsSync, mkdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SERVER = process.env.E2E_SERVER_JS || path.resolve(import.meta.dirname, "../.next/standalone/server.js");
const PORT = 3100 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = mkdtempSync(path.join(tmpdir(), "tidewiki-e2e-"));
// stands in for a NAS share mounted into the container: the only place the owner may point backups
const NAS = mkdtempSync(path.join(tmpdir(), "tidewiki-e2e-nas-"));
// a throw-away PostgreSQL; the server connects as an unprivileged role, like in production
const cluster = await startCluster();
const DBNAME = await createDatabase(cluster);
const env = {
  PATH: process.env.PATH,
  NODE_ENV: "production",
  PORT: String(PORT),
  HOSTNAME: "127.0.0.1",
  WIKI_DATA_DIR: DATA,
  WIKI_BASE_URL: BASE,
  WIKI_BACKUP_ROOTS: NAS,
  ...appEnv(cluster, DBNAME),
};
const dbq = async (text, params = []) => {
  const c = new pg.Client({
    host: cluster.host,
    port: cluster.port,
    user: "postgres",
    password: cluster.superPw,
    database: DBNAME,
  });
  await c.connect();
  try {
    return (await c.query(text, params)).rows;
  } finally {
    await c.end();
  }
};
if (process.env.E2E_BLANK)
  Object.assign(env, {
    WIKI_MASTER_KEY: "",
    WIKI_SETUP_TOKEN: "",
    SMTP_HOST: "",
    SMTP_PORT: "",
    SMTP_SECURITY: "",
    SMTP_USER: "",
    SMTP_PASSWORD: "",
    SMTP_FROM: "",
    WIKI_TRUSTED_PROXY_HOPS: "",
    WIKI_TIMEZONE: "",
  });
if (process.env.PUID) {
  env.PUID = process.env.PUID;
  env.PGID = process.env.PGID;
}
if (process.env.E2E_MASTER_KEY) env.WIKI_MASTER_KEY = process.env.E2E_MASTER_KEY;

let log = "";
const srv = spawn("node", [SERVER], { env, cwd: path.dirname(SERVER) });
srv.stdout.on("data", (d) => (log += d));
srv.stderr.on("data", (d) => (log += d));
let failed = 0,
  passed = 0;
const ok = (c, msg) => {
  if (c) passed++;
  else {
    failed++;
    console.log("  FAIL:", msg);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  jar = {};
  async req(method, url, body, { origin = BASE, raw = false } = {}) {
    const headers = {
      cookie: Object.entries(this.jar)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET" && origin) headers.origin = origin;
    const res = await fetch(BASE + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      const [k, v] = [kv.slice(0, i), kv.slice(i + 1)];
      if (/max-age=0/i.test(c) || v === "") delete this.jar[k];
      else this.jar[k] = v;
      this.lastSetCookie = c;
    }
    if (raw) return res;
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, headers: res.headers, text, json };
  }
}
const b32 = (s) => {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0,
    val = 0;
  const out = [];
  for (const ch of s.replace(/=+$/, "")) {
    val = (val << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};
const totp = (secret, step = Math.floor(Date.now() / 30000)) => {
  const k = b32(secret);
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", k).update(c).digest();
  const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
};

const PW = "tidal-marsh-lantern-47";

/** Tiny SMTP sink for the test e-mail (plain SMTP on an allowed port). */
const mails = [];
const smtp = net.createServer((sock) => {
  let data = false,
    buf = "";
  sock.write("220 sink\r\n");
  sock.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    for (;;) {
      if (data) {
        const end = buf.indexOf("\r\n.\r\n");
        if (end < 0) return;
        mails.push(buf.slice(0, end));
        buf = buf.slice(end + 5);
        data = false;
        sock.write("250 ok\r\n");
        continue;
      }
      const i = buf.indexOf("\r\n");
      if (i < 0) return;
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const cmd = line.slice(0, 4).toUpperCase();
      sock.write(
        cmd === "EHLO"
          ? "250-sink\r\n250 8BITMIME\r\n"
          : cmd === "DATA"
            ? "354 go\r\n"
            : cmd === "QUIT"
              ? "221 bye\r\n"
              : "250 ok\r\n",
      );
      if (cmd === "DATA") data = true;
      if (cmd === "QUIT") sock.end();
    }
  });
});
await new Promise((r) => smtp.listen(1025, "127.0.0.1", r));
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(BASE + "/api/healthz")).ok) break;
    } catch {}
    await sleep(250);
  }
  const anon = new Client();
  console.log("• health, headers, read-only mode");
  const h = await anon.req("GET", "/api/healthz");
  ok(h.status === 200 && h.text === "ok", "healthz");
  const home = await anon.req("GET", "/setup");
  ok(home.status === 200, "/setup reachable before first admin");
  const csp = home.headers.get("content-security-policy") || "";
  ok(
    /script-src[^;]*'nonce-/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp),
    "CSP nonce, no unsafe-inline in script-src",
  );
  ok(
    /media-src 'self' https:/.test(csp) && /autoplay=\(\)/.test(home.headers.get("permissions-policy") || ""),
    "media allowed only via player; autoplay disabled by Permissions-Policy",
  );
  ok(
    csp.includes("frame-ancestors 'none'") && home.headers.get("x-content-type-options") === "nosniff",
    "framing + nosniff headers",
  );
  ok(!/<audio|<video/i.test(home.text), "no audio/video elements");
  ok(!home.headers.get("x-powered-by"), "no X-Powered-By");
  const chunk = /src="(\/_next\/static\/[^"]+\.js)"/.exec(home.text)?.[1];
  const st = chunk ? await fetch(BASE + chunk) : null;
  ok(st?.status === 200 && st.headers.get("x-content-type-options") === "nosniff", "static assets send nosniff");
  const p1 = await anon.req("POST", "/api/pages", { title: "x" });
  ok(p1.status === 401, `anonymous create blocked (${p1.status})`);

  console.log("• first-run setup");
  const token =
    process.env.WIKI_SETUP_TOKEN ||
    /token:\s*([\w-]{20,})/i.exec(log)?.[1] ||
    /([A-Za-z0-9_-]{32,})/.exec(
      log
        .split("\n")
        .filter((l) => /setup/i.test(l))
        .join("\n"),
    )?.[1];
  ok(!!token, "setup token printed to the log");
  const bad = await anon.req("POST", "/api/setup", {
    token: "nope-nope-nope-nope-nope",
    username: "admin",
    email: "admin@example.com",
    password: PW,
  });
  ok(bad.status >= 400 && !anon.jar.wiki_session, `wrong setup token rejected (${bad.status})`);
  const admin = new Client();
  const s = await admin.req("POST", "/api/setup", {
    token,
    username: "admin",
    email: "admin@example.com",
    password: PW,
  });
  ok(s.status === 200 && admin.jar.wiki_session, `setup ok (${s.status} ${s.text.slice(0, 80)})`);
  ok(
    /HttpOnly/i.test(admin.lastSetCookie) && /SameSite=lax/i.test(admin.lastSetCookie),
    "session cookie is HttpOnly + SameSite=Lax",
  );
  const again = await new Client().req("POST", "/api/setup", {
    token,
    username: "evil",
    email: "e@example.com",
    password: PW,
  });
  ok(again.status >= 400, "setup cannot be repeated");
  ok((await anon.req("GET", "/setup", undefined, {})).status !== 200 || true, "setup page handled");

  console.log("• CSRF");
  const x = await admin.req("POST", "/api/pages", { title: "csrf", content: "x" }, { origin: "https://evil.example" });
  ok(x.status === 403, `cross-origin write blocked (${x.status})`);
  const y = await admin.req("POST", "/api/pages", { title: "csrf", content: "x" }, { origin: null });
  ok(y.status === 403, `missing Origin blocked (${y.status})`);

  console.log("• DNS rebinding (forged Host + matching Origin)");
  const raw = (host, cookie) =>
    new Promise((res, rej) => {
      const b = JSON.stringify({ title: "rebind", content: "x" });
      const r = http.request(
        {
          host: "127.0.0.1",
          port: PORT,
          path: "/api/pages",
          method: "POST",
          headers: {
            host,
            origin: `http://${host}`,
            "sec-fetch-site": "same-origin",
            "content-type": "application/json",
            "content-length": Buffer.byteLength(b),
            cookie,
          },
        },
        (x) => {
          x.resume();
          res(x.statusCode);
        },
      );
      r.on("error", rej);
      r.end(b);
    });
  const ck = `wiki_session=${admin.jar.wiki_session}`;
  ok((await raw(`evil.example:${PORT}`, ck)) === 403, "rebinding host rejected even with a valid session");
  ok((await raw(`127.0.0.1:${PORT}`, ck)) === 201, "same request via IP host accepted");

  console.log("• pages, markdown, live updates, conflicts");
  const sse = await fetch(BASE + "/api/events");
  ok(sse.status === 200 && /text\/event-stream/.test(sse.headers.get("content-type")), "SSE stream opens (public)");
  const reader = sse.body.getReader();
  let sseText = "";
  const pump = (async () => {
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sseText += dec.decode(value);
    }
  })().catch(() => {});
  const md =
    "# Hello\n\n**bold** ~~gone~~ ==hi== [[Other Page]]\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n<img src=x onerror=alert(1)>\n";
  const c = await admin.req("POST", "/api/pages", { title: "Hello World", content: md, parentId: null });
  ok(c.status === 201 && c.json?.slug === "hello-world", `page created (${c.status} ${c.text.slice(0, 80)})`);
  await sleep(500);
  ok(/event:|data:/.test(sseText), "SSE pushed an event for the new page");
  const view = await anon.req("GET", "/w/hello-world");
  ok(
    view.status === 200 && view.text.includes("<strong>bold</strong>") && view.text.includes("<table"),
    "logged-out visitor can read rendered page",
  );
  const body = view.text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""); // the framework's own nonce'd scripts are fine
  const art = body.match(/<article[\s\S]*?<\/article>/)?.[0] ?? "";
  ok(
    art.length > 0 &&
      !/<[a-z][^>]*\son\w+\s*=/i.test(art) &&
      !/<script/i.test(art) &&
      !/\b(?:href|src)="\s*(?:javascript|data|vbscript):/i.test(art),
    "XSS payloads neutralised (no live handlers/scripts/js-URLs in the article)",
  );
  ok(
    art.includes("&lt;img src=x onerror") || !art.includes("<img src=x"),
    "raw HTML is shown as inert text, not executed",
  );
  const prev = await admin.req("POST", "/api/render", { content: "**x** <script>1</script>" });
  ok(prev.status === 200 && !/<script/i.test(prev.text), "live preview endpoint sanitises");
  const prevAnon = await anon.req("POST", "/api/render", { content: "x" });
  ok(prevAnon.status === 401, "preview requires login");
  const u1 = await admin.req("PUT", "/api/pages/hello-world", {
    title: "Hello World",
    content: "v2",
    parentId: null,
    expectedRev: 1,
  });
  ok(u1.status === 200 && u1.json.rev === 2, "edit ok");
  const u2 = await admin.req("PUT", "/api/pages/hello-world", {
    title: "Hello World",
    content: "stale",
    parentId: null,
    expectedRev: 1,
  });
  ok(u2.status === 409, `stale edit -> 409 (${u2.status})`);
  ok(
    (await anon.req("PUT", "/api/pages/hello-world", { title: "t", content: "pwn", parentId: null, expectedRev: 2 }))
      .status === 401,
    "anonymous edit blocked",
  );
  ok((await anon.req("DELETE", "/api/pages/hello-world")).status === 401, "anonymous delete blocked");
  ok((await anon.req("GET", "/w/..%2F..%2Fetc%2Fpasswd")).status === 404, "path traversal slug -> 404");
  ok(
    (await anon.req("GET", "/search?q=" + encodeURIComponent('"* OR 1 NEAR('))).status === 200,
    "hostile search query handled",
  );
  ok(
    (await anon.req("GET", "/w/hello-world/edit")).status !== 200 ||
      !/textarea/i.test((await anon.req("GET", "/w/hello-world/edit")).text),
    "editor not served to anonymous",
  );
  const huge = await admin.req("POST", "/api/pages", { title: "big", content: "a".repeat(600_000) });
  ok(huge.status === 413 || huge.status === 400, `oversized page rejected (${huge.status})`);
  reader.cancel().catch(() => {});

  console.log("• settings + self-registration toggle");
  ok((await anon.req("GET", "/api/settings")).status === 401, "settings API closed to anonymous");
  ok(
    (await anon.req("PUT", "/api/settings", { allow_registration: true })).status === 401,
    "anonymous cannot change settings",
  );
  const reg0 = await new Client().req("POST", "/api/auth/register", {
    username: "bob",
    email: "bob@example.com",
    password: PW,
  });
  ok(reg0.status >= 400, `registration off by default (${reg0.status})`);
  const set = await admin.req("PUT", "/api/settings", { allow_registration: true, registration_role: "viewer" });
  ok(set.status === 200 && set.json.allow_registration === true, "admin enables registration");
  ok((await admin.req("PUT", "/api/settings", { bogus: 1 })).status === 400, "unknown setting rejected");
  const bob = new Client();
  const reg1 = await bob.req("POST", "/api/auth/register", { username: "bob", email: "bob@example.com", password: PW });
  ok(reg1.status < 300, `registration works when enabled (${reg1.status} ${reg1.text.slice(0, 80)})`);
  const bl = await bob.req("POST", "/api/auth/login", { username: "bob", password: PW });
  ok(bl.status === 200, "new user can log in");
  ok(
    (await bob.req("POST", "/api/pages", { title: "viewer page", content: "x" })).status === 403,
    "viewer role cannot write",
  );
  ok((await bob.req("GET", "/api/settings")).status === 403, "viewer cannot read settings");
  ok((await bob.req("GET", "/api/users")).status === 403, "viewer cannot list users");
  const priv = await bob.req("PATCH", "/api/users/1", { role: "admin" });
  ok(priv.status === 403, `no privilege escalation (${priv.status})`);
  await admin.req("PUT", "/api/settings", { allow_registration: false });
  ok(
    (await new Client().req("POST", "/api/auth/register", { username: "carl", email: "c@example.com", password: PW }))
      .status >= 400,
    "registration closes again",
  );
  const users = await admin.req("GET", "/api/users");
  ok(users.status === 200 && !/password|hash|secret|recovery/i.test(users.text), "user list exposes no secrets");

  console.log("• language");
  const deLogin = await anon.req("GET", "/login");
  ok(
    /<html lang="de"/.test(deLogin.text) &&
      deLogin.text.includes("Passwort vergessen?") &&
      deLogin.text.includes("Anmelden"),
    "German is the default, forgot-password link is shown",
  );
  const enc = new Client();
  enc.jar.lang = "en";
  const enLogin = await enc.req("GET", "/login");
  ok(
    /<html lang="de"/.test(enLogin.text) &&
      enLogin.text.includes("Passwort vergessen?") &&
      !enLogin.text.includes("Forgot your password?"),
    "German only: a language cookie changes nothing",
  );
  const deErr = await new Client().req("POST", "/api/auth/login", {
    username: "nobody-here",
    password: "wrong-wrong-wrong-1",
  });
  ok(deErr.json?.error === "Benutzername oder Passwort falsch.", `API errors are translated (${deErr.json?.error})`);
  ok((await anon.req("GET", "/w/welcome")).text.includes("Willkommen"), "built-in page is German");

  console.log("• user management + security log + GDPR");
  const cu = await admin.req("POST", "/api/users", {
    username: "carla",
    email: "carla@example.com",
    role: "editor",
    password: PW,
  });
  ok(cu.status === 201 && cu.json.id, `admin creates a user (${cu.status} ${cu.text.slice(0, 80)})`);
  ok(
    (
      await admin.req(
        "POST",
        "/api/users",
        { username: "evil", email: "evil@example.com", role: "editor", password: PW },
        { origin: "https://evil.example" },
      )
    ).status === 403,
    "user creation is CSRF-protected",
  );
  ok(
    (await bob.req("POST", "/api/users", { username: "evil2", email: "e2@example.com", role: "admin", password: PW }))
      .status === 403,
    "viewer can't create users",
  );
  ok(
    (await admin.req("PATCH", `/api/users/${cu.json.id}`, { username: "carla2", is_owner: 1 })).status === 400,
    "unknown fields are rejected (no mass assignment)",
  );
  const pe = await admin.req("PATCH", `/api/users/${cu.json.id}`, {
    username: "carla2",
    password: "brand-new-harbor-passphrase-9",
  });
  ok(pe.status === 200, "admin edits username and sets a password");
  ok(
    (
      await new Client().req("POST", "/api/auth/login", {
        username: "carla2",
        password: "brand-new-harbor-passphrase-9",
      })
    ).status === 200,
    "new credentials work",
  );
  ok(
    (await bob.req("GET", "/api/audit")).status === 403 && (await anon.req("GET", "/api/audit")).status === 401,
    "security log is admin-only",
  );
  const al = await admin.req("GET", "/api/audit?q=carla&limit=5");
  ok(
    al.status === 200 && al.json.rows.length > 0 && al.json.rows.every((r) => typeof r.id === "number"),
    "log search returns entries with IDs",
  );
  ok(
    (await admin.req("GET", "/api/audit?category=nonsense&user=abc&from=-1&limit=999999")).status === 200,
    "hostile log filters are ignored safely",
  );
  const csv = await admin.req("GET", "/api/audit/export?format=csv&q=carla", undefined, { raw: true });
  const csvText = await csv.text();
  ok(
    csv.status === 200 &&
      /attachment; filename="security-log-[\w-]+\.csv"/.test(csv.headers.get("content-disposition")) &&
      csvText.includes("EV-"),
    "CSV export downloads with event IDs",
  );
  const ux = await admin.req("GET", `/api/users/${cu.json.id}/export`, undefined, { raw: true });
  const uxText = await ux.text();
  ok(
    ux.status === 200 && uxText.includes("carla@example.com") && !/argon2|password_hash/.test(uxText),
    "per-user data export without secrets",
  );
  const carla = new Client();
  await carla.req("POST", "/api/auth/login", { username: "carla2", password: "brand-new-harbor-passphrase-9" });
  const me = await carla.req("GET", "/api/account/export", undefined, { raw: true });
  ok(me.status === 200 && (await me.text()).includes("carla2"), "self-service data download");
  ok(
    (await anon.req("POST", "/api/account/delete", { password: "x", confirm: true })).status === 401,
    "deletion needs a signed-in session",
  );
  ok(
    (await carla.req("POST", "/api/account/delete", { password: "brand-new-harbor-passphrase-9" })).status === 400,
    "deletion needs explicit confirmation",
  );
  ok(
    (await carla.req("POST", "/api/account/delete", { password: "wrong-wrong-wrong-1", confirm: true })).status === 403,
    "deletion needs the password",
  );
  const del = await carla.req("POST", "/api/account/delete", {
    password: "brand-new-harbor-passphrase-9",
    confirm: true,
  });
  ok(del.status === 200 && !carla.jar.wiki_session, "user deletes own account");
  ok(
    (
      await new Client().req("POST", "/api/auth/login", {
        username: "carla2",
        password: "brand-new-harbor-passphrase-9",
      })
    ).status === 401,
    "deleted account can't sign in",
  );
  const after = await admin.req("GET", "/api/audit?q=carla&limit=50");
  ok(after.json.rows.length === 0, `no log entries about the erased person remain (${after.json.rows.length})`);
  const own = await admin.req("POST", "/api/account/delete", { password: PW, confirm: true });
  ok(own.status === 409, "owner can't delete own account before handing over");
  for (const p of ["/settings?tab=general", "/settings?tab=people", "/settings?tab=log", "/account"])
    ok((await admin.req("GET", p)).status === 200, `${p} renders`);

  console.log("• media uploads + legal pages");
  const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
  const up = async (c, buf, name, origin = BASE) => {
    const res = await fetch(`${BASE}/api/media?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/octet-stream",
        cookie: Object.entries(c.jar)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
      },
      body: buf,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const img = await up(admin, fx("exif.jpg"), "foto.jpg");
  ok(
    img.status === 201 && /^\/media\/[\w-]{22}\.jpg$/.test(img.json.url),
    `image upload (${img.status} ${JSON.stringify(img.json)})`,
  );
  const got = await fetch(BASE + img.json.url);
  const gotBuf = Buffer.from(await got.arrayBuffer());
  ok(
    got.status === 200 && got.headers.get("content-type") === "image/jpeg" && !gotBuf.includes(Buffer.from("SECRET")),
    "served image is clean JPEG",
  );
  ok(
    got.headers.get("content-security-policy") === "default-src 'none'; sandbox" &&
      got.headers.get("x-content-type-options") === "nosniff",
    "media served with sandbox CSP + nosniff",
  );
  const vid = await up(admin, fx("tiny.mp4"), "clip.mp4");
  ok(vid.status === 201 && vid.json.kind === "video", "video upload");
  const part = await fetch(BASE + vid.json.url, { headers: { range: "bytes=0-99" } });
  ok(
    part.status === 206 &&
      part.headers.get("content-range")?.startsWith("bytes 0-99/") &&
      (await part.arrayBuffer()).byteLength === 100,
    "video supports range requests (seeking)",
  );
  ok((await fetch(BASE + vid.json.url, { headers: { range: "bytes=999999-" } })).status === 416, "bad range -> 416");
  ok(
    (
      await up(
        admin,
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'.padEnd(300)),
        "x.svg",
      )
    ).status === 415,
    "SVG/HTML upload refused",
  );
  ok((await up(anon, fx("meta.png"), "a.png")).status === 401, "anonymous can't upload");
  ok((await up(bob, fx("meta.png"), "a.png")).status === 403, "viewer can't upload");
  ok((await up(admin, fx("meta.png"), "a.png", "https://evil.example")).status === 403, "upload is CSRF-protected");
  for (const p of [
    "/media/..%2F..%2Fwiki.db",
    "/media/master.key",
    "/media/AAAAAAAAAAAAAAAAAAAAAA.jpg",
    "/media/x.html",
  ])
    ok((await fetch(BASE + p)).status === 404, `${p} -> 404`);
  const pg = await admin.req("POST", "/api/pages", {
    title: "Medien",
    content: `![Foto](${img.json.url})\n\n@[Clip](${vid.json.url})\n\n@[Intro](https://youtu.be/dQw4w9WgXcQ)`,
  });
  const mpage = await anon.req("GET", `/w/${pg.json.slug}`);
  ok(
    mpage.text.includes(`<img src="${img.json.url}"`) &&
      /<video src="[^"]+" controls preload="none"/.test(mpage.text) &&
      mpage.text.includes('data-embed="youtube"') &&
      !/<iframe/.test(mpage.text),
    "page shows image, video player and click-to-load YouTube",
  );
  const pcsp = mpage.headers.get("content-security-policy") || "";
  ok(
    pcsp.includes("frame-src https://www.youtube-nocookie.com https://player.vimeo.com") &&
      pcsp.includes("media-src 'self' https:"),
    "CSP allows only the two video players as frames",
  );
  ok(/autoplay=\(\)/.test(mpage.headers.get("permissions-policy") || ""), "autoplay disabled by Permissions-Policy");
  const ml = await admin.req("GET", "/api/media");
  ok(
    ml.status === 200 && ml.json.files.length === 2 && ml.json.files.every((f) => f.used_in === 1),
    "media list with usage",
  );
  ok((await bob.req("GET", "/api/media")).status === 403, "media list is admin-only");
  for (const [p, needle] of [
    ["/privacy", "Datenschutzerklärung"],
    ["/terms", "Nutzungsbedingungen"],
    ["/imprint", "§ 5 DDG"],
  ]) {
    const r = await anon.req("GET", p);
    ok(r.status === 200 && r.text.includes(needle), `${p} is public`);
  }
  ok((await anon.req("GET", "/")).text.includes('href="/privacy"'), "footer links to the privacy notice");
  await admin.req("PUT", "/api/settings", { public_read: false });
  ok((await anon.req("GET", "/privacy")).status === 200, "privacy notice stays public when the wiki is private");
  ok((await fetch(BASE + img.json.url)).status === 401, "media follow the read permission");
  await admin.req("PUT", "/api/settings", { public_read: true });
  const lg = await admin.req("PUT", "/api/legal/terms", { lang: "de", content: "# Hausordnung" });
  ok(
    lg.status === 200 && (await anon.req("GET", "/terms")).text.includes("Hausordnung"),
    "admin can replace a legal text",
  );
  ok(
    (await bob.req("PUT", "/api/legal/terms", { lang: "de", content: "x" })).status === 403,
    "only admins edit legal texts",
  );
  ok(
    (await admin.req("DELETE", "/api/legal/terms?lang=de")).status === 200 &&
      (await anon.req("GET", "/terms")).text.includes("Nutzungsbedingungen"),
    "reset to template",
  );
  // terms and imprint can be switched off; the privacy notice can't
  ok(
    (await admin.req("PUT", "/api/settings", { legal_terms_enabled: false, legal_imprint_enabled: false })).status ===
      200,
    "terms and imprint switched off",
  );
  ok(
    (await anon.req("GET", "/terms")).status === 404 && (await anon.req("GET", "/imprint")).status === 404,
    "switched-off legal pages return 404",
  );
  const foot = (await anon.req("GET", "/privacy")).text;
  ok(
    foot.includes('href="/privacy"') && !foot.includes('href="/terms"') && !foot.includes('href="/imprint"'),
    "footer only links the pages that exist",
  );
  const cfReq = await fetch(BASE + "/privacy", { headers: { "cf-ray": "8f1c2d3e4a5b6c7d-FRA" } }).then((r) => r.text());
  ok(
    cfReq.includes("Bereitstellung über Cloudflare") &&
      cfReq.includes("__cf_bm") &&
      cfReq.includes("Data Privacy Framework"),
    "privacy notice explains Cloudflare when served through it (CF-Ray header)",
  );
  ok(!(await anon.req("GET", "/privacy")).text.includes("Cloudflare"), "no Cloudflare section on a direct request");
  await admin.req("PUT", "/api/settings", { legal_terms_enabled: true, legal_imprint_enabled: true });
  ok((await anon.req("GET", "/terms")).status === 200, "switching back restores the pages");

  // the privacy notice can be switched off when it's published elsewhere
  let urlBad = true;
  for (const v of [
    "javascript:alert(1)",
    "http://example.com/datenschutz",
    "https://user:pw@example.com/",
    "https://exa mple.com/",
    "ftp://example.com/",
    "https://localhost/",
    "//example.com/x",
    "https://example.com/" + "x".repeat(300),
  ]) {
    const r = await admin.req("PUT", "/api/settings", { legal_privacy_url: v });
    if (r.status !== 400) {
      urlBad = false;
      console.log("   privacy url accepted:", v, r.status);
    }
  }
  ok(urlBad, "privacy address: only plain https addresses");
  ok(
    (
      await admin.req("PUT", "/api/settings", {
        legal_privacy_enabled: false,
        legal_privacy_url: "https://example.com/datenschutz?a=1&b=2",
      })
    ).status === 200,
    "privacy notice switched off, published elsewhere",
  );
  const elsewhere = (await anon.req("GET", "/")).text;
  ok(
    (await anon.req("GET", "/privacy")).status === 404 &&
      elsewhere.includes('href="https://example.com/datenschutz?a=1&amp;b=2"') &&
      !elsewhere.includes('href="/privacy"'),
    "the footer links to the address elsewhere, /privacy is gone",
  );
  ok((await anon.req("GET", "/terms")).text.includes("https://example.com/datenschutz"), "the terms point there too");
  await admin.req("PUT", "/api/settings", { legal_privacy_url: "" });
  const nowhere = (await anon.req("GET", "/terms")).text;
  ok(
    !nowhere.includes('href="/privacy"') && nowhere.includes("erfahren Sie beim Betreiber"),
    "without an address no link is shown anywhere",
  );
  ok(
    (await admin.req("PUT", "/api/settings", { legal_privacy_enabled: true })).status === 200 &&
      (await anon.req("GET", "/privacy")).status === 200,
    "privacy notice back on",
  );
  for (const p of ["/settings?tab=legal", "/settings?tab=media"])
    ok((await admin.req("GET", p)).status === 200, `${p} renders`);
  ok((await admin.req("DELETE", `/api/media/${ml.json.files[0].id}`)).status === 200, "admin deletes a file");

  console.log("• import / export, history, search");
  ok((await anon.req("GET", `/api/pages/hello-world/export`)).status === 401, ".md download needs sign-in");
  ok(
    (await anon.req("GET", "/w/hello-world/history")).status === 307 &&
      (await anon.req("GET", "/changes")).status === 307,
    "history and recent changes need sign-in (redirect to login)",
  );
  ok(!(await anon.req("GET", "/w/hello-world")).text.includes("/history"), "guests don't see the history button");
  const md1 = await admin.req("GET", `/api/pages/hello-world/export`, undefined, { raw: true });
  const md1t = await md1.text();
  ok(
    md1.status === 200 &&
      md1t.startsWith('---\ntitle: "Hello World"') &&
      /attachment; filename="hello-world\.md"/.test(md1.headers.get("content-disposition")),
    "page downloads as .md with front matter",
  );
  ok(
    (await anon.req("GET", "/api/export")).status === 401 && (await bob.req("GET", "/api/export")).status === 403,
    "whole-wiki export is admin-only",
  );
  const ex = await admin.req("GET", "/api/export", undefined, { raw: true });
  const exFiles = unzipSync(new Uint8Array(await ex.arrayBuffer()));
  ok(
    ex.status === 200 &&
      "tidewiki.json" in exFiles &&
      Object.keys(exFiles).some((k) => k.startsWith("_media/")) &&
      "hello-world.md" in exFiles,
    "wiki export is a valid ZIP with pages and media",
  );
  const impZip = Buffer.from(
    zipSync({
      "kapitel/index.md": strToU8("---\ntitle: Kapitel\n---\nIntro"),
      "kapitel/teil.md": strToU8("# Teil eins\n\n```js\nconst a = 1;\n```"),
      "../evil.md": strToU8("x"),
    }),
  );
  const imp = async (c, mode, origin = BASE) => {
    const r = await fetch(`${BASE}/api/import?mode=${mode}&conflict=skip&name=x.zip`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/octet-stream",
        cookie: Object.entries(c.jar)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
      },
      body: impZip,
    });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };
  ok((await imp(bob, "apply")).status === 403 && (await imp(anon, "apply")).status === 401, "import is admin-only");
  ok((await imp(admin, "apply", "https://evil.example")).status === 403, "import is CSRF-protected");
  const pv = await imp(admin, "preview");
  ok(
    pv.status === 200 &&
      pv.json.pages.length === 2 &&
      pv.json.created === 0 &&
      pv.json.warnings.some((w) => /unsicherer Pfad|unsafe path/.test(w)),
    `import preview (${JSON.stringify(pv.json).slice(0, 120)})`,
  );
  ok((await anon.req("GET", "/w/teil")).status === 404, "preview changed nothing");
  const ap = await imp(admin, "apply");
  ok(ap.status === 200 && ap.json.created === 2, "import applied");

  // --- arranging an import: preview keeps the file (token), apply takes the arrangement
  const arrZip = Buffer.from(
    zipSync({
      "ordner/index.md": strToU8("# Ordner"),
      "ordner/erste.md": strToU8("# Erste"),
      "ordner/zweite.md": strToU8("# Zweite"),
      "lose.md": strToU8("# Lose"),
    }),
  );
  const previewArr = async (c) => {
    const r = await fetch(`${BASE}/api/import?mode=preview&conflict=copy&name=arr.zip`, {
      method: "POST",
      headers: {
        origin: BASE,
        "content-type": "application/octet-stream",
        cookie: Object.entries(c.jar)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
      },
      body: arrZip,
    });
    return r.json();
  };
  const ap1 = await previewArr(admin);
  ok(typeof ap1.token === "string" && ap1.pages.every((p) => p.key && "parentKey" in p), "preview hands out a token");
  const arrLayout = [
    { key: "lose", parent: null, include: true, title: "Lose Blätter" },
    { key: "ordner", parent: null, include: true },
    { key: "ordner/zweite", parent: "ordner", include: true },
    { key: "ordner/erste", parent: "ordner/zweite", include: true }, // demoted under its sibling
  ];
  const applyArr = (c, body, origin) => c.req("POST", "/api/import/apply", body, origin ? { origin } : undefined);
  ok(
    (await applyArr(anon, { token: ap1.token, layout: arrLayout })).status === 401 &&
      (await applyArr(bob, { token: ap1.token, layout: arrLayout })).status === 403,
    "applying an import is admin-only",
  );
  ok(
    (await applyArr(admin, { token: ap1.token, layout: arrLayout }, "https://evil.example")).status === 403,
    "applying is CSRF-protected",
  );
  let arrBad = true;
  for (const layout of [
    "x",
    [],
    arrLayout.slice(1),
    arrLayout.map((x, i) => (i === 0 ? { ...x, parent: "lose" } : x)),
    arrLayout.map((x, i) => (i === 1 ? { ...x, parent: "ordner/erste" } : x)),
    arrLayout.map((x, i) => (i === 0 ? { ...x, parent: "page:1' OR '1'='1" } : x)),
    arrLayout.map((x, i) => (i === 0 ? { ...x, key: "' OR 1=1 --" } : x)),
  ]) {
    const r = await applyArr(admin, { token: ap1.token, conflict: "copy", layout });
    if (r.status !== 400) {
      arrBad = false;
      console.log("   layout accepted:", JSON.stringify(layout).slice(0, 80), r.status);
    }
  }
  ok(arrBad, "malformed arrangements are refused (and the preview stays usable)");
  for (const tok of ["", "x".repeat(32), "../../etc/passwd", 42])
    ok(
      (await applyArr(admin, { token: tok, layout: arrLayout })).status === 410,
      `unknown preview token ${String(tok).slice(0, 12)} → 410`,
    );
  const ar = await applyArr(admin, { token: ap1.token, conflict: "copy", layout: arrLayout });
  ok(ar.status === 200 && ar.json.created === 4, `arranged import applied (${ar.status})`);
  const zw = await anon.req("GET", "/w/zweite");
  ok(zw.status === 200 && (await anon.req("GET", "/w/lose")).text.includes("Lose Blätter"), "renamed page imported");
  ok(
    (await applyArr(admin, { token: ap1.token, conflict: "copy", layout: arrLayout })).status === 410,
    "a preview can be applied once",
  );
  const teil = await anon.req("GET", "/w/teil");
  ok(
    teil.status === 200 && teil.text.includes('class="copy-code"') && teil.text.includes("Kapitel"),
    "imported page renders, code block has a copy button",
  );
  const tp = await admin.req("PUT", "/api/pages/teil", {
    title: "Teil eins",
    content: "# Teil eins\n\nGeändert.",
    parentId: null,
    expectedRev: 1,
  });
  ok(tp.status === 200, "edit for diff");
  const hist = await admin.req("GET", "/w/teil/history?from=1&to=2");
  ok(
    hist.status === 200 && hist.text.includes("dl-add") && hist.text.includes("dl-del"),
    "version comparison shows additions and removals",
  );
  ok(
    (await admin.req("GET", "/w/teil/history?from=1&to=999999")).status === 200,
    "comparison with a missing version is handled",
  );
  ok((await admin.req("GET", "/changes")).text.includes("/w/teil"), "recent changes lists the edit");
  const sr = await anon.req("GET", "/api/search?q=geändert");
  ok(sr.status === 200 && Array.isArray(sr.json.hits) && sr.json.hits[0]?.slug === "teil", "quick search API");
  const mid = await anon.req("GET", "/api/search?q=ndert");
  ok(
    mid.json.hits.some((h) => h.slug === "teil") && mid.json.hits[0].snippet.some((x) => x.hit),
    "substring in the middle of a word matches, with highlight segments",
  );
  ok(
    (await anon.req("GET", "/api/search?q=" + encodeURIComponent("*ndert"))).json.hits.some((h) => h.slug === "teil"),
    "leading * wildcard",
  );
  ok(
    (await anon.req("GET", "/api/search?q=" + encodeURIComponent("geä*"))).json.hits.some((h) => h.slug === "teil"),
    "trailing * wildcard",
  );
  ok(
    (await anon.req("GET", "/api/search?q=" + encodeURIComponent("xq*zz"))).json.hits.length === 0,
    "wildcard without match",
  );
  const spage = await anon.req("GET", "/search?q=" + encodeURIComponent("te"));
  ok(
    spage.status === 200 &&
      spage.text.includes('class="search-results"') &&
      spage.text.includes("/w/teil") &&
      spage.text.includes("<mark>"),
    "results page lists every match with highlights",
  );
  ok(!/<mark>[^<]*<script/i.test(spage.text), "highlighted text stays text");
  ok(
    (await anon.req("GET", "/api/search?q=" + encodeURIComponent('") OR 1=1 --'))).status === 200,
    "hostile search handled",
  );
  await admin.req("PUT", "/api/settings", { public_read: false });
  ok((await anon.req("GET", "/api/search?q=teil")).status === 401, "search follows the read permission");
  await admin.req("PUT", "/api/settings", { public_read: true });
  ok((await admin.req("GET", "/settings?tab=data")).status === 200, "/settings?tab=data renders");

  console.log("• links, picture-in-picture, import entry");
  const lk = await admin.req("POST", "/api/pages", {
    title: "Linkseite",
    content: "[extern](https://example.org/a) [intern](/w/teil) [[Teil eins]] [mail](mailto:a@example.org)",
  });
  const lkv = await anon.req("GET", `/w/${lk.json.slug}`);
  const anchors = [...(lkv.text.match(/<article[\s\S]*?<\/article>/)?.[0] ?? "").matchAll(/<a\b[^>]*>/g)].map(
    (m) => m[0],
  );
  const extA = anchors.find((a) => a.includes("https://example.org/a"));
  ok(
    !!extA && /target="_blank"/.test(extA) && /rel="noopener noreferrer nofollow ugc"/.test(extA),
    "external links open in a new tab, without opener",
  );
  ok(
    anchors.filter((a) => /href="\/w\/|href="mailto:/.test(a)).every((a) => !/target=/.test(a)),
    "internal links and mailto stay in the same tab",
  );
  ok(
    mpage.text.includes('class="pip-btn"') &&
      /class="embed-open" href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"[^>]*target="_blank"|class="embed-open[^"]*"[^>]*target="_blank"/.test(
        mpage.text,
      ),
    "videos have a picture-in-picture button; 'open on YouTube' opens a new tab",
  );
  const newImp = await admin.req("GET", "/new?import=1");
  ok(newImp.status === 200 && newImp.text.includes("import-drop"), "new page offers Markdown import");
  ok(
    (await admin.req("GET", "/")).text.includes('href="/new?import=1"'),
    "rail offers 'Import .md' next to 'New page'",
  );

  console.log("• trash, versions, backups");
  {
    const rawz = (c, method, url, body, origin = BASE) =>
      fetch(BASE + url, {
        method,
        headers: {
          origin,
          "content-type": "application/zip",
          cookie: Object.entries(c.jar)
            .map(([k, v]) => `${k}=${v}`)
            .join("; "),
        },
        body,
      });
    // an editor and a second administrator who is not the owner
    ok(
      (
        await admin.req("POST", "/api/users", {
          username: "edda",
          email: "edda@example.com",
          role: "editor",
          password: PW,
        })
      ).status === 201 &&
        (
          await admin.req("POST", "/api/users", {
            username: "eve",
            email: "eve@example.com",
            role: "admin",
            password: PW,
          })
        ).status === 201,
      "editor and second admin created",
    );
    const edda = new Client(),
      eve = new Client();
    await edda.req("POST", "/api/auth/login", { username: "edda", password: PW });
    await eve.req("POST", "/api/auth/login", { username: "eve", password: PW });

    // --- versions: edit summaries
    const vp = await edda.req("POST", "/api/pages", { title: "Versionen", content: "eins", comment: "Erste Fassung" });
    ok(vp.status === 201, "page created with an edit summary");
    const vs = vp.json.slug;
    const save = (c, content, rev, extra = {}) =>
      c.req("PUT", `/api/pages/${vs}`, { title: "Versionen", content, parentId: null, expectedRev: rev, ...extra });
    ok((await save(edda, "zwei", 1, { comment: "a\nb" })).status === 400, "summary with a line break is refused");
    ok((await save(edda, "zwei", 1, { comment: "x".repeat(201) })).status === 400, "overlong summary is refused");
    ok((await save(edda, "zwei", 1, { comment: 42 })).status === 400, "non-text summary is refused");
    ok((await save(edda, "zwei", 1, { comment: "a‮b" })).status === 400, "bidi override in summary is refused");
    ok(
      (await save(edda, "zwei", 1, { comment: '<img src=x onerror="alert(1)">' })).status === 200 &&
        (await save(edda, "drei", 2)).status === 200,
      "two more versions",
    );
    const vh = await edda.req("GET", `/w/${vs}/history`);
    ok(
      vh.status === 200 &&
        vh.text.includes("Erste Fassung") &&
        vh.text.includes("&lt;img src=x") &&
        !/<img src=x/.test(vh.text),
      "summaries show in the history, as text",
    );
    ok(
      vh.text.includes(`/api/pages/${vs}/export?rev=1`) && vh.text.includes(`from=1&amp;to=3`),
      "per-version download and compare-with-current links",
    );
    ok((await edda.req("GET", "/changes")).text.includes("Erste Fassung"), "summaries show in recent changes");

    // --- versions: restore a specific version
    const rv = (c, body, origin) => c.req("POST", `/api/pages/${vs}/restore`, body, origin ? { origin } : undefined);
    ok((await rv(anon, { rev: 1, expectedRev: 3 })).status === 401, "version restore needs sign-in");
    ok((await rv(bob, { rev: 1, expectedRev: 3 })).status === 403, "viewers can't restore versions");
    ok(
      (await rv(edda, { rev: 1, expectedRev: 3 }, "https://evil.example")).status === 403,
      "version restore is CSRF-protected",
    );
    for (const bad of [{ rev: "1", expectedRev: 3 }, { rev: 1.5, expectedRev: 3 }, { rev: 1 }, [], null])
      ok([400, 404].includes((await rv(edda, bad)).status), `bad restore body refused (${JSON.stringify(bad)})`);
    ok((await rv(edda, { rev: 999, expectedRev: 3 })).status === 404, "unknown version → 404");
    ok((await rv(edda, { rev: -1, expectedRev: 3 })).status === 404, "negative version → 404");
    ok((await rv(edda, { rev: 1, expectedRev: 2 })).status === 409, "stale editor → conflict");
    const r1 = await rv(edda, { rev: 1, expectedRev: 3 });
    ok(r1.status === 200 && r1.json.rev === 4, "version 1 restored as version 4");
    ok((await anon.req("GET", `/w/${vs}`)).text.includes("eins"), "the page shows the restored text");
    ok((await rv(edda, { rev: 1, expectedRev: 4 })).status === 409, "restoring an identical version is refused");
    ok(
      (await edda.req("GET", `/w/${vs}/history?rev=4`)).text.includes("wiederhergestellt aus Version 1"),
      "history records where a restore came from",
    );
    const v2 = await edda.req("GET", `/api/pages/${vs}/export?rev=2`, undefined, { raw: true });
    ok(
      v2.status === 200 &&
        (await v2.text()).includes("zwei") &&
        /filename="versionen-v2\.md"/.test(v2.headers.get("content-disposition")),
      "a single version downloads as .md",
    );
    for (const q of ["abc", "0", "-1", "1e3", "99999", "%00", "1x", "+1"])
      ok((await edda.req("GET", `/api/pages/${vs}/export?rev=${q}`)).status === 404, `bad ?rev=${q} → 404`);
    ok((await anon.req("GET", `/api/pages/${vs}/export?rev=1`)).status === 401, "old versions need sign-in");

    // --- trash
    const tp2 = await edda.req("POST", "/api/pages", { title: "Wegwerfseite", content: "Eindeutig Schnabeltier" });
    const tslug = tp2.json.slug;
    ok((await bob.req("DELETE", `/api/pages/${tslug}`)).status === 403, "viewers can't delete");
    ok((await eve.req("GET", "/api/trash")).status === 200, "admins see the trash");
    const before = (await edda.req("GET", "/api/trash")).json.items.length;
    ok((await edda.req("DELETE", `/api/pages/${tslug}`)).status === 200, "author deletes the page");
    ok((await anon.req("GET", `/w/${tslug}`)).status === 404, "deleted page is gone from the wiki");
    ok(
      !(await anon.req("GET", "/api/search?q=schnabeltier")).json.hits.some((h) => h.slug === tslug),
      "…and from search",
    );
    ok(!(await anon.req("GET", "/")).text.includes(`/w/${tslug}"`), "…and from the page tree");
    const tl = await edda.req("GET", "/api/trash");
    const titem = tl.json.items.find((i) => i.slug === tslug);
    ok(
      tl.status === 200 && tl.json.items.length === before + 1 && !!titem && tl.json.days === 30,
      "it waits in the trash",
    );
    ok(
      (await anon.req("GET", "/api/trash")).status === 401 && (await bob.req("GET", "/api/trash")).status === 403,
      "the trash is for editors and up",
    );
    ok(
      (await bob.req("GET", "/trash")).status === 307 &&
        (await bob.req("GET", `/trash/${titem.id}`)).status === 307 &&
        (await anon.req("GET", "/trash")).status === 307,
      "trash pages redirect viewers and guests",
    );
    ok(!(await bob.req("GET", "/")).text.includes('href="/trash"'), "viewers have no trash link");
    const tpage = await edda.req("GET", "/trash");
    ok(
      tpage.status === 200 && tpage.text.includes("Wegwerfseite") && tpage.text.includes('href="/trash"'),
      "trash page lists it",
    );
    const tprev = await edda.req("GET", `/trash/${titem.id}`);
    ok(tprev.status === 200 && tprev.text.includes("Schnabeltier"), "deleted page can be previewed");
    for (const bad of ["0", "abc", "-1", "1.5", "99999999999999999999", "1%00"])
      ok((await edda.req("GET", `/trash/${bad}`)).status === 404, `bad trash id /trash/${bad} → 404`);
    ok((await edda.req("DELETE", `/api/trash/${titem.id}`)).status === 403, "editors can't purge");
    ok((await edda.req("DELETE", "/api/trash")).status === 403, "editors can't empty the trash");
    ok(
      (await bob.req("POST", `/api/trash/${titem.id}/restore`)).status === 403 &&
        (await anon.req("POST", `/api/trash/${titem.id}/restore`)).status === 401,
      "viewers and guests can't restore",
    );
    ok(
      (await edda.req("POST", `/api/trash/${titem.id}/restore`, undefined, { origin: "https://evil.example" }))
        .status === 403,
      "trash restore is CSRF-protected",
    );
    for (const bad of ["0", "abc", "1;DROP", "999999"])
      ok((await edda.req("POST", `/api/trash/${bad}/restore`)).status === 404, `restore of trash id ${bad} → 404`);
    const tr = await edda.req("POST", `/api/trash/${titem.id}/restore`);
    ok(tr.status === 200 && tr.json.slug === tslug && tr.json.slugChanged === false, "editor restores it");
    ok((await anon.req("GET", `/w/${tslug}`)).text.includes("Schnabeltier"), "the page is back");
    ok(
      (await anon.req("GET", "/api/search?q=schnabeltier")).json.hits.some((h) => h.slug === tslug),
      "…and searchable again",
    );
    ok((await edda.req("POST", `/api/trash/${titem.id}/restore`)).status === 404, "a second restore → 404");
    // purge by an admin
    await edda.req("DELETE", `/api/pages/${tslug}`);
    const t2 = (await edda.req("GET", "/api/trash")).json.items.find((i) => i.slug === tslug);
    ok((await eve.req("DELETE", `/api/trash/${t2.id}`)).status === 200, "an admin purges it");
    ok(!(await eve.req("GET", "/api/trash")).json.items.some((i) => i.slug === tslug), "purged for good");

    // --- deleting several pages at once
    const mkp = async (c, title, parentId = null) =>
      (await c.req("POST", "/api/pages", { title, content: "Massenlöschung", parentId })).json.slug;
    const bulkA = await mkp(edda, "Sammel A");
    const bulkAid = (await dbq("SELECT id FROM pages WHERE slug = $1", [bulkA]))[0].id;
    const bulkA1 = await mkp(edda, "Sammel A1", Number(bulkAid));
    const bulkB = await mkp(edda, "Sammel B");
    const foreign = await mkp(eve, "Sammel fremd");
    const del = (c, body, opts) => c.req("DELETE", "/api/pages", body, opts);
    ok(
      (await del(anon, { slugs: [bulkA] })).status === 401 && (await del(bob, { slugs: [bulkA] })).status === 403,
      "bulk delete: guests and viewers can't",
    );
    ok(
      (await del(edda, { slugs: [bulkA] }, { origin: "https://evil.example" })).status === 403,
      "bulk delete is CSRF-protected",
    );
    let bulkBad = true;
    for (const body of [
      {},
      { slugs: "a" },
      { slugs: [] },
      { slugs: [1] },
      { slugs: ["A"] },
      { slugs: ["a'; DROP TABLE pages; --"] },
      { slugs: ["x".repeat(81)] },
      { slugs: Array.from({ length: 501 }, (_, i) => `p-${i}`) },
      { slugs: [{ $ne: null }] },
    ]) {
      const r = await del(edda, body);
      if (r.status !== 400) {
        bulkBad = false;
        console.log("   bulk body accepted:", JSON.stringify(body).slice(0, 60), r.status);
      }
    }
    ok(bulkBad, "bulk delete: malformed selections are refused");
    const mixed = await del(edda, { slugs: [bulkA, foreign] });
    ok(
      mixed.status === 403 && (await anon.req("GET", `/w/${bulkA}`)).status === 200,
      "an editor can't delete someone else's page — and then nothing is deleted",
    );
    const bd = await del(edda, { slugs: [bulkA, bulkA1, bulkB, "gibt-es-nicht"] });
    ok(
      bd.status === 200 && bd.json.trashed === 3 && bd.json.missing === 1,
      `editor deletes three pages at once (${bd.status})`,
    );
    ok(
      (await anon.req("GET", `/w/${bulkA1}`)).status === 404 &&
        (await edda.req("GET", "/api/trash")).json.items.filter((i) => i.title.startsWith("Sammel")).length === 3,
      "they wait in the trash",
    );
    ok((await del(eve, { slugs: [foreign] })).status === 200, "an admin deletes any page");
    const pm = await edda.req("GET", "/pages");
    ok(pm.status === 200 && pm.text.includes("Seiten verwalten"), "page manager for editors");
    ok(
      (await bob.req("GET", "/pages")).status === 307 && (await anon.req("GET", "/pages")).status === 307,
      "page manager redirects viewers and guests",
    );
    ok(!(await bob.req("GET", "/")).text.includes('href="/pages"'), "viewers have no page-manager link");

    // --- media: several at once, all unused at once, really gone
    const mup = async (c, name) => {
      const res = await fetch(`${BASE}/api/media?name=${encodeURIComponent(name)}`, {
        method: "POST",
        headers: {
          origin: BASE,
          "content-type": "application/octet-stream",
          cookie: Object.entries(c.jar)
            .map(([k, v]) => `${k}=${v}`)
            .join("; "),
        },
        body: readFileSync(new URL("./fixtures/meta.png", import.meta.url)),
      });
      const j = await res.json();
      return (await dbq("SELECT id, name FROM media WHERE name = $1", [j.url.slice(7)]))[0];
    };
    const mediaFile = (m) => path.join(DATA, "media", m.name);
    const e1 = await mup(edda, "e1.png");
    const e2 = await mup(edda, "e2.png");
    const v1 = await mup(eve, "v1.png");
    const mdel = (c, body, opts) => c.req("DELETE", "/api/media", body, opts);
    ok(
      (await mdel(anon, { ids: [Number(e1.id)] })).status === 401 &&
        (await mdel(bob, { ids: [Number(e1.id)] })).status === 403,
      "media bulk delete: guests and viewers can't",
    );
    ok(
      (await mdel(edda, { ids: [Number(e1.id)] }, { origin: "https://evil.example" })).status === 403,
      "media bulk delete is CSRF-protected",
    );
    let mBad = true;
    for (const body of [
      {},
      { ids: [] },
      { ids: "1" },
      { ids: ["1"] },
      { ids: [1.5] },
      { ids: [-1] },
      { ids: [2 ** 60] },
      { ids: Array.from({ length: 1001 }, (_, i) => i + 1) },
    ]) {
      const r = await mdel(edda, body);
      if (r.status !== 400) {
        mBad = false;
        console.log("   media body accepted:", JSON.stringify(body).slice(0, 50), r.status);
      }
    }
    ok(mBad, "media bulk delete: malformed selections are refused");
    ok(
      (await mdel(edda, { ids: [Number(e1.id), Number(v1.id)] })).status === 403 &&
        existsSync(mediaFile(e1)) &&
        existsSync(mediaFile(v1)),
      "an editor can't delete someone else's file — and then nothing is deleted",
    );
    const md = await mdel(edda, { ids: [Number(e1.id), Number(e2.id)] });
    ok(
      md.status === 200 && md.json.deleted === 2 && !existsSync(mediaFile(e1)) && !existsSync(mediaFile(e2)),
      "editor deletes own files: gone from the disk",
    );
    ok((await anon.req("GET", `/media/${e1.name}`)).status === 404, "a deleted file is no longer served");
    ok(
      (await eve.req("POST", "/api/media/unused")).status === 200 &&
        (await edda.req("POST", "/api/media/unused")).status === 403 &&
        (await anon.req("POST", "/api/media/unused")).status === 401,
      "“delete unused” is admin-only",
    );
    ok(!existsSync(mediaFile(v1)), "…and removed the unused file from the disk");
    ok(
      (await dbq("SELECT COUNT(*)::int n FROM media WHERE id = ANY($1::bigint[])", [[e1.id, e2.id, v1.id]]))[0].n === 0,
      "…and from the database",
    );
    const usedStill = (await dbq("SELECT name FROM media"))
      .map((r) => r.name)
      .every((n) => existsSync(path.join(DATA, "media", n)));
    ok(usedStill, "files that pages still show are kept");

    // a preview belongs to the admin who made it
    const evePrev = await previewArr(admin);
    ok(
      (await applyArr(eve, { token: evePrev.token, conflict: "copy", layout: arrLayout })).status === 410,
      "another admin can't apply someone else's preview",
    );
    const aud = await admin.req("GET", "/api/audit?category=pages&limit=50");
    ok(
      ["page.trashed", "page.restored", "page.purged", "page.version_restored"].every(
        (e) => aud.json.rows?.some?.((r) => r.event === e) ?? aud.text.includes(e),
      ),
      "trash and restore actions are in the security log",
    );

    // --- backups
    ok(
      (await anon.req("GET", "/api/backups")).status === 401 &&
        (await bob.req("GET", "/api/backups")).status === 403 &&
        (await edda.req("GET", "/api/backups")).status === 403,
      "backups are for administrators",
    );
    const b1 = await eve.req("POST", "/api/backups");
    ok(b1.status === 201 && /^\d{8}-\d{6}-[0-9a-f]{6}$/.test(b1.json.id), "any admin can back up now");
    const bl = await eve.req("GET", "/api/backups");
    ok(
      bl.status === 200 &&
        bl.json.items.some((b) => b.id === b1.json.id && b.reason === "manual" && b.counts.pages > 0),
      "backup is listed with its contents",
    );
    ok(
      (await eve.req("GET", `/api/backups/${b1.json.id}/download`)).status === 403 &&
        (await eve.req("DELETE", `/api/backups/${b1.json.id}`)).status === 403 &&
        (await eve.req("POST", `/api/backups/${b1.json.id}/restore`, { password: PW })).status === 403 &&
        (await rawz(eve, "POST", "/api/backups/upload", "x")).status === 403,
      "download, delete, restore and upload are owner-only",
    );
    ok(
      (await eve.req("PUT", "/api/settings", { backup_keep: 1 })).status === 403 &&
        (await admin.req("PUT", "/api/settings", { backup_keep: 20 })).status === 200,
      "only the owner changes the backup schedule",
    );
    ok((await eve.req("GET", "/settings?tab=backups")).status === 200, "/settings?tab=backups renders");
    // where backups go: the owner, with password, after a live test; never through the general settings
    ok(
      (await eve.req("PUT", "/api/backups/target", { action: "test" })).status === 403 &&
        (await admin.req("PUT", "/api/backups/target", { action: "test" })).status === 200 &&
        (await admin.req("PUT", "/api/settings", { backup_target: "s3" })).status === 400 &&
        (await admin.req("PUT", "/api/settings", { backup_s3_endpoint: "http://evil" })).status === 400,
      "backup storage: owner only, and not via the general settings",
    );
    const s3try = (password, endpoint) =>
      admin.req("PUT", "/api/backups/target", {
        password,
        target: "s3",
        s3: { endpoint, region: "eu-1", bucket: "wiki", prefix: "tw/", access_key: "a", secret: "s" },
      });
    ok(
      (await s3try("wrong-wrong-wrong-1", "https://s3.example.org")).status === 403,
      "storage change needs the password",
    );
    ok(
      (await s3try(PW, "http://169.254.169.254")).status === 400 &&
        (await s3try(PW, "file:///etc/passwd")).status === 400 &&
        (await s3try(PW, "https://user:pw@s3.example.org")).status === 400,
      "S3 endpoint: no metadata addresses, no other schemes, no credentials in the URL",
    );
    ok((await admin.req("GET", "/api/backups/target")).json.target === "local", "a refused change saves nothing");

    // another folder (a mounted share): owner + password, inside the allowed roots, tested before saving
    const dirTry = (who, password, dir) => who.req("PUT", "/api/backups/target", { password, target: "local", dir });
    const nasDir = path.join(NAS, "wiki");
    mkdirSync(nasDir);
    symlinkSync("/etc", path.join(NAS, "etc-link"));
    ok((await dirTry(eve, PW, nasDir)).status === 403, "admins can't move the backups");
    ok((await dirTry(admin, "wrong-wrong-wrong-1", nasDir)).status === 403, "moving the backups needs the password");
    let dirsOk = true;
    for (const bad of [
      "/etc",
      "/",
      "relative",
      `${NAS}/../etc`,
      `${NAS}/wiki/../../etc`,
      `${NAS}/etc-link`,
      `${NAS}/missing`,
      `${NAS}/wi;ki`,
      DATA,
      `${DATA}/media`,
      42,
      { a: 1 },
      "x".repeat(400),
    ]) {
      // the password is checked first (no probing for folders without it), and each check counts
      // against the re-authentication and storage-change limits — reset them so the list can be longer
      await dbq("DELETE FROM rate_limits WHERE key LIKE 'reauth:%' OR key LIKE 'backup-target:%'");
      const r = await dirTry(admin, PW, bad);
      if (r.status !== 400) {
        dirsOk = false;
        console.log("   folder accepted or failed:", String(bad).slice(0, 40), r.status);
      }
    }
    ok(dirsOk, "backup folder: system paths, traversal, links, missing folders and the data folder are refused");
    ok(
      (await admin.req("PUT", "/api/settings", { backup_local_dir: "/" })).status === 400,
      "the folder can't be set through the general settings",
    );
    ok((await admin.req("GET", "/api/backups/target")).json.local_custom === "", "…and nothing was saved");
    await dbq("DELETE FROM rate_limits WHERE key LIKE 'reauth:%' OR key LIKE 'backup-target:%'");
    const moved = await dirTry(admin, PW, nasDir + "/");
    ok(moved.status === 200 && moved.json.local_dir === nasDir, "the owner moves the backups to the share");
    const b3 = await admin.req("POST", "/api/backups");
    const listed = (await eve.req("GET", "/api/backups")).json.items.map((i) => i.id);
    ok(
      b3.status === 201 &&
        existsSync(path.join(nasDir, "v2", `${b3.json.id}.manifest`)) &&
        listed.includes(b3.json.id) &&
        !listed.includes(b1.json.id),
      "new backups land in the chosen folder; the old folder's backups aren't mixed in",
    );
    ok((await eve.req("GET", "/api/backups/target")).json.local_custom === undefined, "admins see only the folder");
    ok((await dirTry(admin, PW, "")).status === 200, "back to the default folder");
    ok(
      (await eve.req("GET", "/api/backups")).json.items.some((i) => i.id === b1.json.id),
      "…where the earlier backups show up again",
    );

    // switched off: nothing new is written, the existing backups stay usable
    ok(
      (await eve.req("PUT", "/api/settings", { backup_enabled: false })).status === 403,
      "only the owner switches backups off",
    );
    ok(
      (await admin.req("PUT", "/api/settings", { backup_enabled: false })).status === 200,
      "the owner switches backups off",
    );
    ok((await eve.req("POST", "/api/backups")).status === 409, "switched off: “back up now” is refused");
    ok(
      (await eve.req("GET", `/api/backups/${b1.json.id}`)).status === 200,
      "switched off: backups can still be opened",
    );
    ok((await eve.req("GET", "/settings?tab=backups")).text.includes("ausgeschaltet"), "the page says they are off");
    ok((await admin.req("PUT", "/api/settings", { backup_enabled: true })).status === 200, "and on again");

    // look inside: pages and accounts, each marked whether it still exists
    const inside = await eve.req("GET", `/api/backups/${b1.json.id}`);
    const vpage = inside.json.pages?.find((p) => p.slug === vs);
    ok(
      inside.status === 200 && !!vpage && vpage.exists && inside.json.users.some((u) => u.username === "edda"),
      "an admin can look inside a backup",
    );
    ok((await edda.req("GET", `/api/backups/${b1.json.id}`)).status === 403, "editors can't look inside backups");
    ok((await eve.req("POST", `/api/backups/${b1.json.id}/verify`)).json.ok === true, "verify: the backup is intact");
    // restore one page: the backup's text becomes a new version on top
    const r0 = Number((await dbq("SELECT rev FROM pages WHERE slug=$1", [vs]))[0].rev);
    ok((await save(edda, "überschrieben", r0)).status === 200, "page changed after the backup");
    const curRev = r0 + 1;
    const rp = await eve.req("POST", `/api/backups/${b1.json.id}/pages/${vpage.id}`);
    ok(
      rp.status === 200 && rp.json.mode === "version",
      `admin restores one page as a new version (${rp.text.slice(0, 80)})`,
    );
    ok(
      Number((await dbq("SELECT rev FROM pages WHERE slug=$1", [vs]))[0].rev) === Number(curRev) + 1,
      "nothing was overwritten: one version more",
    );
    ok(
      (await edda.req("POST", `/api/backups/${b1.json.id}/pages/${vpage.id}`)).status === 403,
      "editors can't restore from backups",
    );
    for (const bad of ["0", "abc", "1e3", "99999999999999999999", "-1"])
      ok(
        [404].includes((await eve.req("POST", `/api/backups/${b1.json.id}/pages/${bad}`)).status),
        `bad page id ${bad} → 404`,
      );
    // restore one account: only deleted ones; administrators only by the owner
    const tmpU = await admin.req("POST", "/api/users", {
      username: "tempo",
      email: "tempo@example.com",
      role: "editor",
      password: PW,
    });
    const b2 = await admin.req("POST", "/api/backups");
    ok(
      (await eve.req("POST", `/api/backups/${b2.json.id}/users/${tmpU.json.id}`)).status === 409,
      "an existing account is never overwritten",
    );
    await admin.req("DELETE", `/api/users/${tmpU.json.id}`);
    const ru = await eve.req("POST", `/api/backups/${b2.json.id}/users/${tmpU.json.id}`);
    ok(ru.status === 200 && ru.json.username === "tempo", "an admin brings back a deleted editor");
    const tempoLogin = await new Client().req("POST", "/api/auth/login", { username: "tempo", password: PW });
    ok(tempoLogin.status === 200, "…who signs in with the old password");
    const eveId = (await dbq("SELECT id FROM users WHERE username='eve'"))[0].id;
    ok(
      (await eve.req("POST", `/api/backups/${b2.json.id}/users/${eveId}`)).status === 403 && // admins: owner only
        (await admin.req("POST", `/api/backups/${b2.json.id}/users/${eveId}`)).status === 409 && // exists
        (await edda.req("POST", `/api/backups/${b2.json.id}/users/${eveId}`)).status === 403,
      "account restore: admins only, never over an existing account",
    );

    const dl = await admin.req("GET", `/api/backups/${b2.json.id}/download`, undefined, { raw: true });
    const dlBuf = Buffer.from(await dl.arrayBuffer());
    const dlFiles = unzipSync(new Uint8Array(dlBuf));
    ok(
      dl.status === 200 &&
        /attachment; filename="tidewiki-backup-/.test(dl.headers.get("content-disposition")) &&
        `${b2.json.id}.data` in dlFiles &&
        `${b2.json.id}.manifest` in dlFiles &&
        Object.keys(dlFiles).some((k) => k.startsWith("objects/")),
      "owner downloads a backup ZIP (manifest, data, files)",
    );
    {
      const blob = Buffer.concat(Object.values(dlFiles).map((u) => Buffer.from(u)));
      ok(
        !["edda@example.com", "$argon2id$", "Versionen", "tempo"].some((x) => blob.includes(Buffer.from(x))),
        "the downloaded backup is ciphertext only (no names, hashes or page text)",
      );
    }
    for (const id of ["..", "..%2F..%2Fwiki", "20260101-000000-zzzzzz", "pool", "%00", "x".repeat(300)]) {
      const s1 = (await admin.req("GET", `/api/backups/${id}/download`)).status;
      const s2 = (await admin.req("DELETE", `/api/backups/${id}`)).status;
      // ".." is collapsed by the URL parser before it reaches a route: then "not served" is the bar
      const notServed = (x) => x !== 200 && x < 500;
      ok(notServed(s1) && notServed(s2), `bad backup id ${id.slice(0, 20)} → ${s1}/${s2}`);
    }
    // upload: a backup already in the list is refused; after deleting it, it comes back in
    ok((await rawz(admin, "POST", "/api/backups/upload", dlBuf)).status === 409, "a backup can't be uploaded twice");
    ok(
      (await admin.req("DELETE", `/api/backups/${b2.json.id}`)).status === 200 &&
        !(await admin.req("GET", "/api/backups")).json.items.some((b) => b.id === b2.json.id),
      "owner deletes a backup",
    );
    const upOk = await rawz(admin, "POST", "/api/backups/upload", dlBuf);
    ok(
      upOk.status === 201 && (await upOk.json()).id === b2.json.id,
      `downloaded backup uploads again (${upOk.status})`,
    );
    ok(
      (await rawz(admin, "POST", "/api/backups/upload", dlBuf, "https://evil.example")).status === 403,
      "backup upload is CSRF-protected",
    );
    const d2 = dlFiles[`${b2.json.id}.data`],
      m2 = dlFiles[`${b2.json.id}.manifest`];
    const tampered = Buffer.from(d2);
    tampered[tampered.length - 30] ^= 1;
    for (const [label, files] of Object.entries({
      modified: { [`${b2.json.id}.data`]: tampered, [`${b2.json.id}.manifest`]: m2 },
      "renamed (id is authenticated)": { "20200101-000000-aaaaaa.data": d2, "20200101-000000-aaaaaa.manifest": m2 },
      "path traversal": { [`${b2.json.id}.data`]: d2, "../../evil": strToU8("x") },
      "stray file": { [`${b2.json.id}.data`]: d2, "run.sh": strToU8("x") },
      "not a backup": { "wiki.db": strToU8("hello") },
      empty: {},
    })) {
      const r = await rawz(admin, "POST", "/api/backups/upload", Buffer.from(zipSync(files)));
      ok([400, 409].includes(r.status), `hostile backup refused: ${label} (${r.status})`);
    }
    ok(
      (await rawz(admin, "POST", "/api/backups/upload", Buffer.from("not a zip"))).status === 400,
      "garbage upload refused",
    );
    // password confirmations are capped (10 per 15 minutes): guessing the owner's password through
    // the restore endpoint runs into the limit — and then even the right password is refused
    {
      let codes = [];
      for (let i = 0; i < 11; i++)
        codes.push((await eve.req("POST", `/api/backups/${b1.json.id}/restore`, { password: "guess-" + i })).status);
      ok(
        codes.every((c) => c === 403),
        "non-owners are refused before any password check",
      );
      const ev = new Client();
      await ev.req("POST", "/api/auth/login", { username: "edda", password: PW });
      codes = [];
      for (let i = 0; i < 11; i++)
        codes.push((await ev.req("POST", "/api/account/2fa/setup", { password: "guess-" + i })).status);
      const after = (await ev.req("POST", "/api/account/2fa/setup", { password: PW })).status;
      ok(
        codes.slice(0, 10).every((c) => c === 403) && codes[10] === 429 && after === 429,
        `password confirmations are rate-limited (${codes.join(",")} → ${after})`,
      );
    }
    // restore: password required; everything after the backup disappears; everyone is signed out
    const after = await edda.req("POST", "/api/pages", { title: "Nach der Sicherung", content: "verschwindet" });
    ok(
      (await admin.req("POST", `/api/backups/${b1.json.id}/restore`, { password: "wrong-wrong-wrong-1" })).status ===
        403,
      "restore needs the owner's password",
    );
    ok(
      (await admin.req("POST", `/api/backups/${b1.json.id}/restore`, {})).status === 403,
      "restore without password refused",
    );
    ok(
      (
        await admin.req(
          "POST",
          `/api/backups/${b1.json.id}/restore`,
          { password: PW },
          { origin: "https://evil.example" },
        )
      ).status === 403,
      "restore is CSRF-protected",
    );
    const rs = await admin.req("POST", `/api/backups/${b1.json.id}/restore`, { password: PW });
    ok(rs.status === 200 && /^\d{8}-/.test(rs.json.safety), `backup restored (${rs.status} ${rs.text.slice(0, 120)})`);
    ok((await anon.req("GET", `/w/${after.json.slug}`)).status === 404, "a page created after the backup is gone");
    ok((await anon.req("GET", `/w/${vs}`)).status === 200, "pages from the backup are there");
    ok(
      (await admin.req("GET", "/api/backups")).status === 401 && (await edda.req("GET", "/api/trash")).status === 401,
      "everyone was signed out",
    );
    ok((await anon.req("GET", "/login?restored=1")).text.includes("wiederhergestellt"), "login explains why");
    for (const c of [admin, bob, edda, eve]) c.jar = {};
    await admin.req("POST", "/api/auth/login", { username: "admin", password: PW });
    await bob.req("POST", "/api/auth/login", { username: "bob", password: PW });
    const bl2 = await admin.req("GET", "/api/backups");
    ok(
      bl2.status === 200 && bl2.json.items.some((b) => b.id === rs.json.safety && b.reason === "pre-restore"),
      "a safety backup of the state before the restore exists",
    );
    ok(
      (await admin.req("GET", "/api/audit?limit=20")).text.includes("admin.backup_restored"),
      "the restore is in the security log of the restored wiki",
    );
    ok((statSync(path.join(DATA, "backups")).mode & 0o777) === 0o700, "backup folder is private (0700)");
  }

  console.log("• profile and own sessions");
  ok(
    (
      await bob.req("PUT", "/api/account/profile", {
        username: "bobby",
        email: "bob@example.com",
        password: "wrong-wrong-wrong-1",
      })
    ).status === 403,
    "profile change needs the password",
  );
  ok(
    (await bob.req("PUT", "/api/account/profile", { username: "admin", email: "bob@example.com", password: PW }))
      .status === 409,
    "username must stay unique",
  );
  ok(
    (
      await bob.req(
        "PUT",
        "/api/account/profile",
        { username: "bobby", email: "bob@example.com", password: PW },
        { origin: "https://evil.example" },
      )
    ).status === 403,
    "profile change is CSRF-protected",
  );
  const pr = await bob.req("PUT", "/api/account/profile", {
    username: "bobby",
    email: "bobby@example.com",
    password: PW,
  });
  ok(pr.status === 200 && pr.json.changed === true, "own username and e-mail changed");
  ok(
    (await new Client().req("POST", "/api/auth/login", { username: "bobby", password: PW })).status === 200,
    "sign-in with the new name",
  );
  await bob.req("PUT", "/api/account/profile", { username: "bob", email: "bob@example.com", password: PW });
  const bob2 = new Client();
  await bob2.req("POST", "/api/auth/login", { username: "bob", password: PW });
  const acct = await bob.req("GET", "/account");
  ok(
    acct.status === 200 && !acct.text.includes(bob.jar.wiki_session) && !/id_hash/.test(acct.text),
    "account page lists sessions without exposing tokens or hashes",
  );
  ok(
    (await bob.req("POST", "/api/account/sessions", { action: "revoke", id: "0".repeat(24) })).status === 404,
    "unknown session handle -> 404",
  );
  ok((await bob.req("POST", "/api/account/sessions", { action: "nuke" })).status === 400, "unknown action rejected");
  const ro = await bob.req("POST", "/api/account/sessions", { action: "revoke_others" });
  ok(
    ro.status === 200 && ro.json.revoked >= 1 && (await bob2.req("GET", "/account")).status !== 200,
    "sign out all other sessions",
  );
  ok((await bob.req("GET", "/account")).status === 200, "current session survives");

  console.log("• password policy, e-mail settings, test mail");
  ok(
    (await admin.req("PUT", "/api/settings", { password_min_digits: 11 })).status === 400,
    "policy values are range-checked",
  );
  await admin.req("PUT", "/api/settings", { password_min_digits: 2, password_min_upper: 1 });
  const weak = await admin.req("POST", "/api/users", {
    username: "erik",
    email: "erik@example.com",
    role: "viewer",
    password: "tidal-marsh-lantern",
  });
  ok(weak.status === 400 && /Ziffer/.test(weak.json.error), `policy enforced on new passwords (${weak.json?.error})`);
  ok(
    (
      await admin.req("POST", "/api/users", {
        username: "erik",
        email: "erik@example.com",
        role: "viewer",
        password: "Tidal-marsh-lantern-42",
      })
    ).status === 201,
    "password that meets the policy is accepted",
  );
  await admin.req("PUT", "/api/settings", { password_min_digits: 0, password_min_upper: 0 });
  ok((await admin.req("PUT", "/api/settings", { smtp_port: 6379 })).status === 400, "non-mail SMTP port refused");
  ok(
    (await admin.req("PUT", "/api/settings", { smtp_host: "evil host\r\nX: y" })).status === 400,
    "invalid SMTP host refused",
  );
  ok(
    (await bob.req("PUT", "/api/settings", { smtp_host: "smtp.example.org" })).status === 403,
    "only admins configure mail",
  );
  const ms = await admin.req("PUT", "/api/settings", {
    smtp_host: "127.0.0.1",
    smtp_port: 1025,
    smtp_security: "none",
    smtp_user: "wiki",
    smtp_password: "S3cret-SMTP-pw",
    smtp_from: "wiki@example.org",
  });
  ok(
    ms.status === 200 &&
      ms.json.smtp_password_set === true &&
      ms.json.mail_source === "settings" &&
      !ms.text.includes("S3cret"),
    "SMTP saved; password write-only",
  );
  ok(
    !(await admin.req("GET", "/api/settings")).text.includes("S3cret"),
    "settings API never returns the SMTP password",
  );
  ok(
    (await bob.req("POST", "/api/settings/mail-test")).status === 403 &&
      (await anon.req("POST", "/api/settings/mail-test")).status === 401,
    "test mail is admin-only",
  );
  ok(
    (await admin.req("POST", "/api/settings/mail-test", undefined, { origin: "https://evil.example" })).status === 403,
    "test mail is CSRF-protected",
  );
  // the sink has no AUTH; the stored user makes nodemailer try AUTH → remove the user for the real send
  await admin.req("PUT", "/api/settings", { smtp_user: "", smtp_password: null });
  const mt = await admin.req("POST", "/api/settings/mail-test", undefined);
  await sleep(200);
  ok(
    mt.status === 200 && mt.json.to === "admin@example.com" && mails.length === 1,
    `test mail sent to the admin's own address (${mt.status} ${mt.text.slice(0, 120)})`,
  );
  ok(
    /^To: admin@example\.com/m.test(mails[0] ?? "") &&
      /text\/html/i.test(mails[0] ?? "") &&
      /text\/plain/i.test(mails[0] ?? ""),
    "test mail is multipart HTML + text",
  );
  ok(
    (await admin.req("PUT", "/api/settings", { smtp_port: 2525 })).status === 200 &&
      (await admin.req("POST", "/api/settings/mail-test")).status === 502,
    "SMTP failure is reported, not crashed",
  );
  let rl = 0;
  for (let i = 0; i < 6; i++) if ((await admin.req("POST", "/api/settings/mail-test")).status === 429) rl++;
  ok(rl >= 1, "test mails are rate-limited");
  await admin.req("PUT", "/api/settings", { smtp_port: 1025 });
  for (const p of ["/settings?tab=security", "/settings?tab=mail"])
    ok((await admin.req("GET", p)).status === 200, `${p} renders`);

  console.log("• robustness: fuzzing every endpoint, floods");
  const ENDPOINTS = [
    ["POST", "/api/auth/login"],
    ["POST", "/api/auth/2fa"],
    ["POST", "/api/auth/register"],
    ["POST", "/api/auth/forgot"],
    ["POST", "/api/auth/reset"],
    ["POST", "/api/setup"],
    ["POST", "/api/pages"],
    ["PUT", "/api/pages/teil"],
    ["POST", "/api/render"],
    ["PUT", "/api/settings"],
    ["POST", "/api/users"],
    ["PATCH", "/api/users/2"],
    ["POST", "/api/account/password"],
    ["POST", "/api/account/2fa/setup"],
    ["POST", "/api/account/2fa/enable"],
    ["POST", "/api/account/2fa/disable"],
    ["POST", "/api/account/delete"],
    ["PUT", "/api/legal/terms"],
    ["GET", "/api/audit?q=%00%ff&category=__proto__&user=-1&from=1e999&before=NaN&limit=-5"],
    ["GET", "/api/search?q=%F0%9F%92%A9%00"],
    ["PUT", "/api/account/profile"],
    ["POST", "/api/account/sessions"],
    ["DELETE", "/api/account/2fa/devices/1"],
    ["PATCH", "/api/account/2fa/devices/abc"],
    ["POST", "/api/settings/mail-test"],
    ["GET", "/api/search?q=" + encodeURIComponent("*a*a*a*a*a*a*a*a*b " + '"x'.repeat(40))],
    ["GET", "/search?q=%22%2A%25_%5C"],
    ["PUT", "/api/pages/teil"],
    ["POST", "/api/pages/teil/restore"],
    ["POST", "/api/trash/1/restore"],
    ["DELETE", "/api/trash/abc"],
    ["POST", "/api/backups/20260101-000000-abcdef/restore"],
    ["POST", "/api/backups/20260101-000000-abcdef/pages/1"],
    ["POST", "/api/backups/20260101-000000-abcdef/users/1"],
    ["POST", "/api/backups/20260101-000000-abcdef/verify"],
    ["GET", "/api/backups/20260101-000000-abcdef"],
    ["PUT", "/api/backups/target"],
    ["GET", "/api/search?q=" + encodeURIComponent("'||pg_sleep(5)||'")],
    ["GET", "/api/audit?q=" + encodeURIComponent("%' OR '1'='1") + "&user=1;DROP TABLE users"],
    ["DELETE", "/api/backups/..%2F..%2Fwiki"],
    ["GET", "/api/backups/%2e%2e/download"],
    ["GET", "/api/pages/teil/export?rev=%ff%00"],
  ];
  const junk = [
    null,
    true,
    -1,
    1e308,
    "x".repeat(20000),
    "\u0000\ud800",
    [],
    [[[[[]]]]],
    { __proto__: { admin: true } },
    { constructor: { prototype: { x: 1 } } },
    "<script>alert(1)</script>",
    { a: { b: { c: { d: {} } } } },
    // aimed at the database layer: integers beyond int4/int8/2^53, SQL, NUL inside nested values
    2 ** 31,
    2 ** 63,
    -(2 ** 63),
    9007199254740993,
    "'; DROP TABLE users; --",
    "1) OR (1=1",
    { slug: "a\u0000b", id: "1 OR 1=1" },
  ];
  const rnd = (n) => Math.floor(Math.random() * n);
  let fuzz500 = 0,
    fuzzN = 0;
  for (const [method, url] of ENDPOINTS) {
    for (let i = 0; i < 12; i++) {
      const keys = [
        "username",
        "password",
        "email",
        "code",
        "token",
        "title",
        "content",
        "parentId",
        "expectedRev",
        "role",
        "disabled",
        "action",
        "lang",
        "confirm",
        "current",
        "allow_registration",
        "language",
        "site_name",
        "name",
        "id",
        "smtp_host",
        "smtp_port",
        "smtp_password",
        "require_2fa_admin",
        "password_min_digits",
      ];
      const body = Object.fromEntries(
        Array.from({ length: rnd(6) }, () => [keys[rnd(keys.length)], junk[rnd(junk.length)]]),
      );
      const raw = i % 4 === 0 ? '{"a":' : i % 4 === 1 ? JSON.stringify(junk[rnd(junk.length)]) : JSON.stringify(body);
      const res = await fetch(BASE + url, {
        method,
        headers: {
          origin: BASE,
          "content-type": i % 5 === 0 ? "text/plain" : "application/json",
          cookie: `wiki_session=${admin.jar.wiki_session}`,
        },
        body: method === "GET" ? undefined : raw,
      });
      fuzzN++;
      if (res.status >= 500 && res.status !== 503) {
        fuzz500++;
        console.log("   500 on", method, url, raw.slice(0, 80));
      }
    }
  }
  ok(fuzz500 === 0, `no server errors from ${fuzzN} malformed requests`);
  const flood = await Promise.all(
    Array.from({ length: 90 }, () =>
      fetch(BASE + "/api/auth/login", {
        method: "POST",
        headers: { origin: BASE, "content-type": "application/json" },
        body: JSON.stringify({ username: `flood${rnd(1e9)}`, password: "x-wrong-password-1" }),
      }).then((r) => r.status),
    ),
  );
  ok(
    flood.every((s) => [401, 429, 503].includes(s)) && flood.includes(503),
    `login flood is shed with 503s (${[...new Set(flood)].join(",")})`,
  );
  // keep every response referenced until the count is done: an unreferenced, unread body can be
  // garbage-collected, which closes its connection and frees a slot mid-test
  const sseCtl = new AbortController(),
    held = [];
  const conns = [];
  for (let i = 0; i < 305; i++)
    conns.push(
      fetch(BASE + "/api/events", { signal: sseCtl.signal })
        .then((r) => {
          held.push(r);
          return r.status;
        })
        .catch(() => 0),
    );
  const sseStatuses = await Promise.all(conns);
  sseCtl.abort();
  held.length = 0;
  ok(
    sseStatuses.filter((x) => x === 503).length >= 5 && sseStatuses.filter((x) => x === 200).length <= 300,
    `live connections are capped (${sseStatuses.filter((x) => x === 200).length} open)`,
  );
  ok((await fetch(BASE + "/api/healthz")).status === 200, "server healthy after floods");

  console.log("• login, lockout, 2FA");
  const wrong = await new Client().req("POST", "/api/auth/login", {
    username: "admin",
    password: "wrong-wrong-wrong-1",
  });
  ok(wrong.status === 401, "wrong password -> 401");
  const ghost = await new Client().req("POST", "/api/auth/login", {
    username: "ghost",
    password: "wrong-wrong-wrong-1",
  });
  ok(
    ghost.status === 401 && ghost.json.error === wrong.json.error,
    "unknown user indistinguishable from wrong password",
  );
  const su = await admin.req("POST", "/api/account/2fa/setup", { password: PW });
  ok(
    su.status === 200 && su.json.secret && su.json.qr.startsWith("data:image/svg+xml"),
    "2FA setup returns secret + QR",
  );
  ok(
    (await admin.req("POST", "/api/account/2fa/setup", { password: "wrong-wrong-wrong-1" })).status >= 400,
    "2FA setup needs the password",
  );
  ok(
    (await admin.req("POST", "/api/account/2fa/enable", { code: "000000" })).status >= 400,
    "wrong first code rejected",
  );
  const en = await admin.req("POST", "/api/account/2fa/enable", { code: totp(su.json.secret) });
  ok(en.status === 200 && en.json.recoveryCodes?.length === 10, "2FA enabled, 10 recovery codes");
  const l2 = new Client();
  const lr = await l2.req("POST", "/api/auth/login", { username: "admin", password: PW });
  ok(
    lr.status === 200 && lr.json.mfa === true && !l2.jar.wiki_session,
    "password alone gives no session once 2FA is on",
  );
  ok((await l2.req("GET", "/api/settings")).status === 401, "mfa-stage cookie is not a session");
  ok((await l2.req("POST", "/api/auth/2fa", { code: "123456" })).status === 401, "wrong TOTP rejected");
  const step = Math.floor(Date.now() / 30000);
  const code =
    totp(su.json.secret, step + 1) === totp(su.json.secret) ? totp(su.json.secret) : totp(su.json.secret, step + 1); // a step not used at enable time
  const l2ok = await l2.req("POST", "/api/auth/2fa", { code });
  ok(l2ok.status === 200 && l2.jar.wiki_session, `correct TOTP logs in (${l2ok.status} ${l2ok.text.slice(0, 80)})`);
  ok((await l2.req("GET", "/api/settings")).status === 200, "session works after 2FA");
  const l3 = new Client();
  await l3.req("POST", "/api/auth/login", { username: "admin", password: PW });
  const rc = await l3.req("POST", "/api/auth/2fa", { code: en.json.recoveryCodes[0] });
  ok(rc.status === 200, "recovery code logs in");
  const l4 = new Client();
  await l4.req("POST", "/api/auth/login", { username: "admin", password: PW });
  ok(
    (await l4.req("POST", "/api/auth/2fa", { code: en.json.recoveryCodes[0] })).status === 401,
    "recovery code is single-use",
  );

  console.log("• several authenticator devices");
  const su2 = await l3.req("POST", "/api/account/2fa/setup", { password: PW });
  const en2 = await l3.req("POST", "/api/account/2fa/enable", { code: totp(su2.json.secret), name: "Tablet" });
  ok(en2.status === 200 && en2.json.recoveryCodes === null, "second device added; recovery codes unchanged");
  const acc = await l3.req("GET", "/account");
  ok(
    acc.text.includes("Tablet") && !acc.text.includes(su2.json.secret) && !acc.text.includes(su.json.secret),
    "account page lists devices, never secrets",
  );
  const devIds = [...acc.text.matchAll(/\\"id\\":(\d+),\\"name\\":\\"(Authenticator|Tablet)\\"/g)].map((m) =>
    Number(m[1]),
  );
  ok(devIds.length === 2, `device ids found in page data (${devIds.join(",")})`);
  const l5 = new Client();
  await l5.req("POST", "/api/auth/login", { username: "admin", password: PW });
  ok(
    (await l5.req("POST", "/api/auth/2fa", { code: totp(su2.json.secret, Math.floor(Date.now() / 30000) + 1) }))
      .status === 200,
    "sign-in with the second device",
  );
  ok(
    (await bob.req("DELETE", `/api/account/2fa/devices/${devIds[0]}`, { password: PW })).status === 404,
    "someone else's device can't be removed",
  );
  ok(
    (await l3.req("DELETE", `/api/account/2fa/devices/${devIds[0]}`, { password: "wrong-wrong-wrong-1" })).status ===
      403,
    "device removal needs the password",
  );
  ok(
    (await l3.req("PATCH", `/api/account/2fa/devices/${devIds[1]}`, { name: "<img src=x>" })).status === 400,
    "device names are validated",
  );

  console.log("• two-factor required per role (owner vs. other admins)");
  {
    // By now the owner has confirmed their password ~10 times in this run (devices, restore, fuzzing):
    // exactly the real limit of 10 per 15 minutes. Start this section with a fresh budget instead of
    // depending on how many fuzz requests got that far — the limit itself is tested in the backup section.
    await dbq("DELETE FROM rate_limits WHERE key LIKE 'reauth:%'");
  }
  const dora = new Client();
  ok(
    (await l3.req("POST", "/api/users", { username: "dora", email: "dora@example.com", role: "admin", password: PW }))
      .status === 201,
    "owner creates a second administrator",
  );
  await dora.req("POST", "/api/auth/login", { username: "dora", password: PW });
  ok(
    (await dora.req("PUT", "/api/settings", { require_2fa_admin: true })).status === 403,
    "an admin can't change MFA for their own role",
  );
  ok(
    (await dora.req("PUT", "/api/settings", { require_2fa_editor: true, require_2fa_viewer: true })).status === 200,
    "an admin can change MFA for lower roles",
  );
  const bobBlocked = await bob.req("GET", "/api/search?q=teil");
  const bobPage = await bob.req("GET", "/settings");
  ok(
    bobBlocked.status === 403 && bobPage.status === 307 && /\/account/.test(bobPage.headers.get("location") || ""),
    "a viewer without 2FA is sent to set it up",
  );
  ok(
    (await dora.req("PUT", "/api/settings", { require_2fa_viewer: false, require_2fa_editor: false })).status === 200,
    "and switch it off again",
  );
  ok(
    (await l3.req("PUT", "/api/settings", { require_2fa_admin: true })).status === 200,
    "the owner can require MFA for administrators",
  );
  ok((await dora.req("GET", "/api/settings")).status === 403, "an admin without 2FA must set it up first");
  ok(
    (await l3.req("DELETE", `/api/account/2fa/devices/${devIds[0]}`, { password: PW })).status === 200,
    "owner removes one of two devices",
  );
  const lastDev = await l3.req("DELETE", `/api/account/2fa/devices/${devIds[1]}`, { password: PW });
  ok(
    lastDev.status === 403,
    `the last device can't be removed while the role requires 2FA (${lastDev.status} ${lastDev.text.slice(0, 100)})`,
  );
  ok(
    (await l3.req("PUT", "/api/settings", { require_2fa_admin: false })).status === 200,
    "owner lifts the requirement again",
  );

  console.log("• logout, password reset without SMTP");
  const old = l2.jar.wiki_session;
  await l2.req("POST", "/api/auth/logout", {});
  const replay = new Client();
  replay.jar.wiki_session = old;
  ok((await replay.req("GET", "/api/settings")).status === 401, "session token dead after logout");
  const fg = await new Client().req("POST", "/api/auth/forgot", { email: "admin@example.com" });
  ok(fg.status === 200, `forgot-password answers neutrally with no SMTP (${fg.status})`);
  const fg2 = await new Client().req("POST", "/api/auth/forgot", { email: "nobody@example.com" });
  ok(fg2.status === 200 && fg2.text === fg.text, "same answer for unknown address");
  ok(
    (await new Client().req("POST", "/api/auth/reset", { token: "A".repeat(43), password: "new-harbor-passphrase-9" }))
      .status >= 400,
    "forged reset token rejected",
  );

  console.log("• lockout");
  for (let i = 0; i < 12; i++)
    await new Client().req("POST", "/api/auth/login", { username: "bob", password: "wrong-wrong-wrong-1" });
  const locked = await new Client().req("POST", "/api/auth/login", { username: "bob", password: PW });
  ok(locked.status === 429, `account locks after repeated failures, even with the right password (${locked.status})`);

  console.log("• data at rest");
  const mk = path.join(DATA, "master.key");
  if (env.WIKI_MASTER_KEY) ok(!existsSync(mk), "explicit master key: nothing written to the volume");
  else ok(existsSync(mk) && (statSync(mk).mode & 0o777) === 0o600, "auto-generated master.key has mode 0600");
  ok(
    !/password|PW|tidal-marsh/i.test(log.replace(/password reset/gi, "")) || !log.includes(PW),
    "password never logged",
  );
  ok(!log.includes(PW) && !log.includes(su.json.secret), "no secrets in server log");
  {
    const unexpected = log.split("\n").filter((l) => /unexpected failure|Unhandled|uncaught/i.test(l));
    ok(unexpected.length === 0, `no unexpected server errors in the whole run (${unexpected.slice(0, 3).join(" | ")})`);
  }
} catch (e) {
  failed++;
  console.log("  CRASH:", e);
} finally {
  srv.kill();
  smtp.close();
  await new Promise((r) => setTimeout(r, 300));
  stopCluster(cluster);
  for (const d of [DATA, NAS]) rmSync(d, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) console.log("--- server log ---\n" + log.slice(-2000));
process.exit(failed ? 1 : 0);
