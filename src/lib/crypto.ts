import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config";

/**
 * Master key handling.
 * Order: WIKI_MASTER_KEY (env / .env) -> WIKI_MASTER_KEY_FILE (Docker secret) -> auto-generated
 * file inside the data volume (0600). All sub-keys are derived with HKDF-SHA256 so a
 * single secret never gets used for two different purposes.
 */
let master: Buffer | null = null;

function parseKey(raw: string): Buffer {
  const t = raw.trim();
  const buf = /^[0-9a-fA-F]{64,}$/.test(t) ? Buffer.from(t, "hex") : Buffer.from(t, "base64");
  if (buf.length < 32)
    throw new Error("WIKI_MASTER_KEY must decode to at least 32 bytes (use: openssl rand -base64 48)");
  return buf;
}

export function loadMasterKey(): Buffer {
  if (master) return master;
  if (process.env.WIKI_MASTER_KEY) {
    master = parseKey(process.env.WIKI_MASTER_KEY);
  } else if (process.env.WIKI_MASTER_KEY_FILE) {
    master = parseKey(readFileSync(process.env.WIKI_MASTER_KEY_FILE, "utf8"));
  } else {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const file = path.join(/* turbopackIgnore: true */ DATA_DIR, "master.key");
    if (!existsSync(file)) {
      writeFileSync(file, randomBytes(48).toString("base64"), { mode: 0o600, flag: "wx" });
    }
    try {
      chmodSync(file, 0o600);
    } catch {
      /* best effort on exotic filesystems */
    }
    master = parseKey(readFileSync(file, "utf8"));
  }
  return master;
}

/** Tests only: forget the cached key, so the next use reads WIKI_MASTER_KEY / master.key again. */
export const resetMasterKeyForTests = () => {
  master = null;
};

export function deriveKey(purpose: "pepper" | "aes" | "hmac"): Buffer {
  return Buffer.from(hkdfSync("sha256", loadMasterKey(), Buffer.from("tidewiki/v1"), Buffer.from(purpose), 32));
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Constant-time string comparison (hashes first so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** AES-256-GCM. `aad` binds the ciphertext to its row so it can't be swapped between users. */
export function encrypt(plain: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", deriveKey("aes"), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), ct.toString("base64url"), c.getAuthTag().toString("base64url")].join(".");
}

export function decrypt(blob: string, aad: string): string {
  const [v, iv, ct, tag] = blob.split(".");
  if (v !== "v1" || !iv || !ct || !tag) throw new Error("Bad ciphertext");
  const d = createDecipheriv("aes-256-gcm", deriveKey("aes"), Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

export const hmac = (data: string) => createHmac("sha256", deriveKey("hmac")).update(data).digest("hex");
