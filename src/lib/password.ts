import { hash, verify } from "@node-rs/argon2";
import { createHmac } from "node:crypto";
import { deriveKey } from "./crypto";
import { HttpError } from "./validate";
import { policyChecks, RULE_MESSAGES, type PasswordPolicy } from "./password-policy";

// Argon2id, 64 MiB, 3 passes (above the OWASP minimum of 19 MiB / 2 passes).
const PARAMS = { memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

// Argon2 is deliberately memory hungry: cap concurrent hashes so a burst of login
// attempts cannot exhaust container memory.
let active = 0;
const waiting: Array<() => void> = [];
const MAX_CONCURRENT = 3;
// …and cap the queue too: beyond this many waiting requests answer "busy" instead of piling up.
const MAX_WAITING = 48;
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    if (waiting.length >= MAX_WAITING) throw new HttpError(503, "The server is busy. Please try again in a moment.");
    await new Promise<void>((r) => waiting.push(r));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/** Server-side pepper: HMAC the password before Argon2 so a stolen DB alone is not enough. */
const pepper = (pw: string) => createHmac("sha256", deriveKey("pepper")).update(pw, "utf8").digest("base64");

export const hashPassword = (pw: string) => slot(() => hash(pepper(pw), PARAMS));

export async function verifyPassword(stored: string, pw: string): Promise<boolean> {
  return slot(async () => {
    try {
      return await verify(stored, pepper(pw));
    } catch {
      return false;
    }
  });
}

export function needsRehash(stored: string): boolean {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(stored);
  if (!m) return true;
  return Number(m[1]) < PARAMS.memoryCost || Number(m[2]) < PARAMS.timeCost || Number(m[3]) !== PARAMS.parallelism;
}

let dummy: Promise<string> | null = null;
/** Burn the same CPU for unknown users so response time doesn't reveal valid usernames. */
export async function verifyDummy(pw: string): Promise<void> {
  dummy ??= hashPassword("tidewiki-dummy-password");
  await verifyPassword(await dummy, pw);
}

const COMMON = new Set(
  `password passw0rd password1 password123 123456789012 qwertyuiop12 letmein12345 iloveyou1234 administrator
welcome12345 changeme1234 admin1234567 qwerty123456 abc123456789 111111111111 123123123123 1q2w3e4r5t6y wikiwikiwiki
passwordpassword correcthorsebatterystaple`.split(/\s+/),
);

export function checkPasswordStrength(
  pw: string,
  policy: PasswordPolicy,
  ctx: { username?: string; email?: string } = {},
): string | null {
  if (typeof pw !== "string") return "Password is required.";
  if (pw.length > 256) return "Password is too long (max 256 characters).";
  const failed = policyChecks(pw, policy).find((r) => !r.ok);
  if (failed) return RULE_MESSAGES[failed.id].replace("{n}", String(failed.n));
  const low = pw.toLowerCase();
  if (COMMON.has(low)) return "That password is on lists of commonly used passwords.";
  if (/^(.)\1+$/.test(pw)) return "Don’t repeat a single character.";
  if (ctx.username && ctx.username.length >= 3 && low.includes(ctx.username.toLowerCase()))
    return "Don’t include your username in the password.";
  const local = ctx.email?.split("@")[0];
  if (local && local.length >= 4 && low.includes(local.toLowerCase()))
    return "Don’t include your email name in the password.";
  return null;
}
