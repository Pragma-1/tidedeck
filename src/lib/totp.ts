import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 4226 / RFC 6238 implementation (SHA-1, 6 digits, 30 s) — what every authenticator app supports.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0,
    value = 0,
    out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0,
    value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateSecret = () => base32Encode(randomBytes(20)); // 160 bit

export function hotp(secret: Buffer, counter: number, digits = 6, algo: "sha1" | "sha256" | "sha512" = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algo, secret).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/**
 * Returns the matched time-step (so the caller can refuse replays) or null.
 * Window of ±1 step tolerates clock drift. Comparison is constant-time.
 */
export function verifyTotp(secretB32: string, code: string, nowMs = Date.now(), lastUsedStep = 0): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const step = Math.floor(nowMs / 30000);
  let matched: number | null = null;
  for (const delta of [-1, 0, 1]) {
    const s = step + delta;
    const expected = Buffer.from(hotp(secret, s));
    const ok = timingSafeEqual(expected, Buffer.from(code));
    if (ok && s > lastUsedStep && matched === null) matched = s; // keep looping: constant work
  }
  return matched;
}

export function otpauthUri(secretB32: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
