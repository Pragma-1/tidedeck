// Remote attack/hardening battery for a running Tidewiki instance.
// Run it from a machine that can reach the target (this is the part a sandbox can't do for you).
//
//   node tests/attack.mjs https://tide.astaldo.eu
//
// Authenticated surface too (optional — logs in and fuzzes the privileged endpoints):
//   ATTACK_USER=alfons ATTACK_PASS='…' node tests/attack.mjs https://tide.astaldo.eu
//   …plus ATTACK_TOTP_SECRET=BASE32SECRET   if that account has 2FA
//
// Knobs:  ATTACK_FLOOD=120 (login attempts)   ATTACK_SSE=60 (held SSE connections)
//         ATTACK_AUTHED_WRITES=1  also fuzz authenticated *write* endpoints (creates junk pages — test box only)
//
// Safe by default: the login flood uses random non-existent usernames, so your real account is never
// locked out, and destructive authed endpoints (account/user deletion, ownership transfer) are never called.
// Exits non-zero if any check fails or any request returns a 5xx (that's the real signal: an unhandled path).

import { createHmac } from "node:crypto";

const BASE = (process.argv[2] || process.env.ATTACK_BASE || "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(BASE)) {
  console.error("usage: node tests/attack.mjs <https://host>   (or set ATTACK_BASE)");
  process.exit(2);
}
const HTTPS = BASE.startsWith("https://");
const FLOOD = Number(process.env.ATTACK_FLOOD || 120);
const SSE = Number(process.env.ATTACK_SSE || 60);
const AUTHED_WRITES = process.env.ATTACK_AUTHED_WRITES === "1";

let pass = 0,
  fail = 0,
  fives = 0;
const ok = (c, msg) => {
  if (c) pass++;
  else {
    fail++;
    console.log("  FAIL:", msg);
  }
};
const note = (msg) => console.log("  ·", msg);
const rnd = (n) => Math.floor(Math.random() * n);

class Client {
  jar = {};
  lastSetCookie = [];
  async req(method, path, { body, origin = BASE, headers = {}, signal } = {}) {
    const h = { ...headers };
    const cookie = Object.entries(this.jar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    if (cookie) h.cookie = cookie;
    if (method !== "GET" && origin) h.origin = origin;
    if (body !== undefined && !h["content-type"]) h["content-type"] = "application/json";
    const res = await fetch(BASE + path, {
      method,
      headers: h,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      redirect: "manual",
      signal,
    });
    this.lastSetCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of this.lastSetCookie) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      const k = kv.slice(0, i),
        v = kv.slice(i + 1);
      if (/max-age=0/i.test(c) || v === "") delete this.jar[k];
      else {
        this.jar[k] = v;
        if (/wiki_session/.test(k)) this.sessionCookieLine = c; // remember flags for inspection
      }
    }
    if (res.status >= 500 && res.status !== 503) {
      fives++;
      console.log(`  5xx: ${method} ${path} -> ${res.status}`);
    }
    return res;
  }
}

/* --------- TOTP (only needed in authenticated mode on a 2FA account) --------- */
const b32 = (s) => {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0,
    val = 0;
  const out = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const idx = A.indexOf(ch);
    if (idx < 0) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};
const totp = (secret, step = Math.floor(Date.now() / 30000)) => {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(step));
  const hm = createHmac("sha1", b32(secret)).update(c).digest();
  const o = hm[19] & 15;
  return String((hm.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
};

const JUNK = [
  null,
  true,
  -1,
  1e308,
  "x".repeat(50000),
  "\u0000\ud800",
  [],
  [[[[[[]]]]]],
  { __proto__: { admin: true } },
  { constructor: { prototype: { polluted: true } } },
  "<script>alert(1)</script>",
  "' OR 1=1 --",
  "../../../../etc/passwd",
  { a: { b: { c: { d: { e: {} } } } } },
];
const KEYS = [
  "slugs",
  "token",
  "layout",
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
  "name",
  "id",
  "smtp_host",
  "smtp_port",
  "smtp_password",
  "require_2fa_admin",
  "password_min_digits",
  "site_name",
  "allow_registration",
];

async function run() {
  console.log(`\nTarget: ${BASE}\n`);
  const anon = new Client();

  // ---- reachability ----
  let health;
  try {
    health = await anon.req("GET", "/api/healthz");
  } catch (e) {
    console.error("Cannot reach target:", e.message);
    process.exit(2);
  }
  ok(health.status === 200, `/api/healthz reachable (got ${health.status})`);

  // ---- security headers (on a public page) ----
  console.log("• security headers");
  const home = await anon.req("GET", "/login");
  const H = (n) => home.headers.get(n) || "";
  const csp = H("content-security-policy");
  ok(/script-src[^;]*'nonce-/.test(csp), "CSP: nonce-based script-src");
  ok(!/script-src[^;]*'unsafe-inline'/.test(csp), "CSP: no unsafe-inline in script-src");
  ok(/frame-ancestors 'none'/.test(csp) || !!H("x-frame-options"), "framing denied");
  ok(H("x-content-type-options").toLowerCase() === "nosniff", "X-Content-Type-Options: nosniff");
  ok(!H("x-powered-by"), "no X-Powered-By header");
  if (HTTPS) ok(!!H("strict-transport-security"), "HSTS present on HTTPS");
  else note("target is http:// — Secure cookies and HSTS are off (expected without TLS)");

  // ---- setup must be closed on a live instance ----
  const setup = await anon.req("GET", "/setup");
  ok(
    setup.status === 307 || setup.status === 302 || (setup.status === 200 && !/name="token"/i.test(await setup.text())),
    `first-run /setup is closed (got ${setup.status})`,
  );

  // ---- anonymous authorization ----
  console.log("• anonymous access is refused");
  for (const [m, p, want] of [
    ["POST", "/api/pages", 401],
    ["GET", "/api/settings", 401],
    ["GET", "/api/audit", 401],
    ["GET", "/api/users", 401],
    ["POST", "/api/users", 401],
    ["PUT", "/api/account/profile", 401],
    ["POST", "/api/settings/mail-test", 401],
    ["PUT", "/api/settings", 401],
    ["GET", "/api/trash", 401],
    ["DELETE", "/api/trash", 401],
    ["POST", "/api/trash/1/restore", 401],
    ["DELETE", "/api/trash/1", 401],
    ["POST", "/api/pages/welcome/restore", 401],
    ["GET", "/api/pages/welcome/export?rev=1", 401],
    ["GET", "/api/backups", 401],
    ["POST", "/api/backups", 401],
    ["POST", "/api/backups/upload", 401],
    ["GET", "/api/backups/20260101-000000-abcdef/download", 401],
    ["POST", "/api/backups/20260101-000000-abcdef/restore", 401],
    ["DELETE", "/api/backups/20260101-000000-abcdef", 401],
    ["DELETE", "/api/pages", 401],
    ["POST", "/api/import/apply", 401],
    ["DELETE", "/api/media", 401],
    ["POST", "/api/media/unused", 401],
  ]) {
    const r = await anon.req(m, p, { body: m === "GET" ? undefined : {} });
    ok(r.status === want, `${m} ${p} -> ${r.status} (want ${want})`);
  }

  // ---- CSRF: cross-origin write is blocked ----
  console.log("• CSRF / origin checks");
  const x = await anon.req("POST", "/api/auth/login", {
    body: { username: "x", password: "y" },
    origin: "https://evil.example",
  });
  ok(x.status === 403, `cross-origin POST blocked (${x.status})`);
  const noOrigin = await anon.req("POST", "/api/auth/login", { body: { username: "x", password: "y" }, origin: null });
  ok(noOrigin.status === 403, `missing-Origin POST blocked (${noOrigin.status})`);

  // ---- path traversal / sensitive paths ----
  // The property is "never served" (not 2xx) and "no file bytes" — NOT a specific status code.
  // A private wiki answers 401 (and gives no existence oracle); an edge WAF may 400 encoded slashes;
  // a page route may 307 to /login. All fine. Only a 2xx response or leaked bytes is a finding.
  console.log("• traversal / sensitive paths are never served");
  for (const p of [
    "/w/..%2f..%2f..%2fetc%2fpasswd",
    "/media/..%2f..%2fwiki.db",
    "/media/master.key",
    "/media/x.html",
    "/media/AAAAAAAAAAAAAAAAAAAAAA.jpg",
  ]) {
    const r = await anon.req("GET", p);
    const body = await r.text().catch(() => "");
    const served = r.status >= 200 && r.status < 300;
    const leaked = /root:.*:0:0:|-----BEGIN |SQLite format 3/.test(body);
    ok(!served, `${p} not served (status ${r.status})`);
    ok(!leaked, `${p} leaks no file content`);
  }

  // ---- hostile search ----
  console.log("• hostile search input");
  // encodeURIComponent throws on lone surrogates, so encode char by char and fall back to U+FFFD.
  const encQ = (q) =>
    Array.from(q)
      .map((c) => {
        try {
          return encodeURIComponent(c);
        } catch {
          return "%EF%BF%BD";
        }
      })
      .join("");
  for (const q of ['"* OR 1 NEAR(', "a*".repeat(80), "%_\\", "\u0000\ud800", "💩".repeat(50), "*".repeat(300)]) {
    const r = await anon.req("GET", `/api/search?q=${encQ(q)}`);
    ok(r.status < 500 || r.status === 503, `search(${JSON.stringify(q).slice(0, 24)}) -> ${r.status}`);
  }

  // ---- fuzz every public-reachable endpoint ----
  console.log("• fuzzing endpoints with malformed bodies");
  const ENDPOINTS = [
    ["POST", "/api/auth/login"],
    ["POST", "/api/auth/2fa"],
    ["POST", "/api/auth/register"],
    ["POST", "/api/auth/forgot"],
    ["POST", "/api/auth/reset"],
    ["POST", "/api/setup"],
    ["POST", "/api/pages"],
    ["POST", "/api/render"],
    ["PUT", "/api/settings"],
    ["POST", "/api/account/profile"],
    ["POST", "/api/account/sessions"],
    ["POST", "/api/account/password"],
    ["POST", "/api/account/2fa/enable"],
    ["DELETE", "/api/account/2fa/devices/1"],
    ["PATCH", "/api/account/2fa/devices/abc"],
    ["POST", "/api/settings/mail-test"],
    ["GET", "/api/audit?q=%00%ff&category=__proto__&user=-1&from=1e999&before=NaN&limit=-5"],
    ["GET", "/api/search?q=%F0%9F%92%A9%00&x=%00"],
    ["POST", "/api/trash/abc/restore"],
    ["DELETE", "/api/pages"],
    ["POST", "/api/import/apply"],
    ["DELETE", "/api/media"],
    ["POST", "/api/media/unused"],
    ["POST", "/api/backups/..%2F..%2Fwiki/restore"],
    ["GET", "/api/backups/%2e%2e%2fpool/download"],
  ];
  let fuzzN = 0;
  for (const [m, p] of ENDPOINTS) {
    for (let i = 0; i < 10; i++) {
      const bodyObj = Object.fromEntries(
        Array.from({ length: rnd(5) }, () => [KEYS[rnd(KEYS.length)], JUNK[rnd(JUNK.length)]]),
      );
      const raw =
        i % 4 === 0 ? '{"a":' : i % 4 === 1 ? JSON.stringify(JUNK[rnd(JUNK.length)]) : JSON.stringify(bodyObj);
      const ct = i % 5 === 0 ? "text/plain" : "application/json";
      try {
        await anon.req(m, p, m === "GET" ? {} : { body: raw, headers: { "content-type": ct } });
        fuzzN++;
      } catch {
        /* network hiccup */
      }
    }
  }
  ok(fives === 0, `no 5xx across ${fuzzN} malformed requests (saw ${fives})`);

  // ---- bounded login flood (random usernames: never locks a real account) ----
  console.log(`• login flood (${FLOOD} random usernames)`);
  const flood = await Promise.all(
    Array.from({ length: FLOOD }, () =>
      anon
        .req("POST", "/api/auth/login", { body: { username: `flood-${rnd(1e9)}`, password: "wrong-pw-123456" } })
        .then((r) => r.status)
        .catch(() => 0),
    ),
  );
  const bad = flood.filter((s) => ![401, 429, 503, 400].includes(s));
  ok(bad.length === 0, `flood responses all 400/401/429/503 (outliers: ${[...new Set(bad)].join(",") || "none"})`);
  note(`flood status mix: ${JSON.stringify(tally(flood))}`);

  // ---- bounded SSE connection flood ----
  console.log(`• live-connection flood (${SSE} concurrent)`);
  const ctl = new AbortController();
  const held = [];
  const sse = await Promise.all(
    Array.from({ length: SSE }, () =>
      fetch(BASE + "/api/events", { signal: ctl.signal })
        .then((r) => {
          held.push(r);
          return r.status;
        })
        .catch(() => 0),
    ),
  );
  ok(
    sse.every((s) => s === 200 || s === 503 || s === 401),
    `SSE responses sane (${JSON.stringify(tally(sse))})`,
  );
  ctl.abort();
  held.length = 0;

  // ---- authenticated surface (optional) ----
  if (process.env.ATTACK_USER && process.env.ATTACK_PASS) {
    console.log("• authenticated surface");
    const me = new Client();
    const login = await me.req("POST", "/api/auth/login", {
      body: { username: process.env.ATTACK_USER, password: process.env.ATTACK_PASS },
    });
    let authed = login.status === 200 && !!me.jar["wiki_session"] && !me.lastSetCookie.join().includes("wiki_mfa");
    const data = await login
      .clone?.()
      .json?.()
      .catch(() => ({}));
    if (login.status === 200 && data?.mfa) {
      if (!process.env.ATTACK_TOTP_SECRET) {
        note("account has 2FA; set ATTACK_TOTP_SECRET to test the authenticated surface. Skipping.");
      } else {
        // try current and next step to avoid the just-used-step rejection
        const step = Math.floor(Date.now() / 30000);
        let r2 = await me.req("POST", "/api/auth/2fa", { body: { code: totp(process.env.ATTACK_TOTP_SECRET, step) } });
        if (r2.status !== 200)
          r2 = await me.req("POST", "/api/auth/2fa", {
            body: { code: totp(process.env.ATTACK_TOTP_SECRET, step + 1) },
          });
        authed = r2.status === 200 && !!me.jar["wiki_session"];
      }
    }
    ok(authed, `signed in as ${process.env.ATTACK_USER} (${login.status})`);

    if (authed) {
      const who = await me.req("GET", "/api/settings");
      const isAdmin = who.status === 200;
      note(isAdmin ? "account is an administrator" : "account is a non-admin (settings 403 as expected)");
      ok(who.status === 200 || who.status === 403, `GET /api/settings -> ${who.status}`);

      // cookie flags on the live session cookie we were issued
      const cl = me.sessionCookieLine || "";
      if (cl) {
        ok(/httponly/i.test(cl), "session cookie is HttpOnly");
        ok(/samesite=(lax|strict)/i.test(cl), "session cookie is SameSite Lax/Strict");
        if (HTTPS) {
          ok(/;\s*secure/i.test(cl), "session cookie is Secure (HTTPS)");
          ok(/^__Host-/.test(cl), "session cookie uses __Host- prefix (HTTPS)");
        }
      }

      // fuzz safe authenticated endpoints (no destructive calls)
      console.log("• fuzzing authenticated endpoints (non-destructive)");
      const before = fives;
      const SAFE = [
        ["POST", "/api/render"],
        ["POST", "/api/account/sessions"],
        ["PATCH", "/api/account/2fa/devices/abc"],
        ["POST", "/api/account/2fa/setup"],
        ["GET", "/api/audit?q=%00&limit=-1&category=__proto__"],
        ["GET", "/api/search?q=%00%ff"],
        ["GET", "/api/trash"],
        ["POST", "/api/trash/0/restore"],
        ["POST", "/api/backups/00000000-000000-000000/restore"],
        // without a valid preview token nothing is imported
        ["POST", "/api/import/apply"],
        ...(isAdmin ? [["POST", "/api/settings/mail-test"]] : []),
      ];
      for (const [m, p] of SAFE) {
        for (let i = 0; i < 8; i++) {
          const raw = JSON.stringify(
            Object.fromEntries(Array.from({ length: rnd(4) }, () => [KEYS[rnd(KEYS.length)], JUNK[rnd(JUNK.length)]])),
          );
          await me.req(m, p, m === "GET" ? {} : { body: raw }).catch(() => {});
        }
      }
      ok(fives === before, `no 5xx from authenticated fuzzing (saw ${fives - before})`);

      if (AUTHED_WRITES && isAdmin) {
        console.log("• fuzzing authenticated WRITE endpoints (creates junk — test box only)");
        const before2 = fives;
        for (const [m, p] of [
          ["POST", "/api/pages"],
          ["PUT", "/api/settings"],
          ["POST", "/api/users"],
          ["DELETE", "/api/pages"], // junk slugs: only junk pages could ever match
        ]) {
          for (let i = 0; i < 10; i++) {
            const raw = JSON.stringify(
              Object.fromEntries(
                Array.from({ length: rnd(5) }, () => [KEYS[rnd(KEYS.length)], JUNK[rnd(JUNK.length)]]),
              ),
            );
            await me.req(m, p, { body: raw }).catch(() => {});
          }
        }
        ok(fives === before2, `no 5xx from authenticated write fuzzing (saw ${fives - before2})`);
      }

      await me.req("POST", "/api/auth/logout", { body: {} }).catch(() => {});
    }
  } else {
    note("no ATTACK_USER/ATTACK_PASS set — authenticated surface not tested");
  }

  console.log(`\n${pass} passed, ${fail} failed, ${fives} server-error (5xx) responses`);
  process.exit(fail || fives ? 1 : 0);
}

function tally(arr) {
  const t = {};
  for (const s of arr) t[s] = (t[s] || 0) + 1;
  return t;
}

run().catch((e) => {
  console.error("CRASH:", e);
  process.exit(2);
});
