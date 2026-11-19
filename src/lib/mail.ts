import nodemailer from "nodemailer";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { readFileSync } from "node:fs";
import { one, run, sql } from "./db";
import { decrypt, encrypt } from "./crypto";
import { getSettings } from "./settings";
import { HttpError } from "./validate";
import { forbiddenAddress } from "./net-guard";

/*
 * Outgoing mail. Configuration comes from Settings → E-mail when a host is set there, otherwise
 * from SMTP_* in .env. The SMTP password from the settings page is stored AES-256-GCM encrypted
 * and is never sent back to the browser.
 */

/** Ports a mail server can listen on. Anything else (Redis, HTTP, databases …) is refused, so the
 *  SMTP client can't be turned into a cross-protocol request forger against internal services. */
export const SMTP_PORTS = [25, 26, 465, 587, 1025, 2525] as const;
const HOST_RE =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
export const validSmtpHost = (h: string) => HOST_RE.test(h) || isIP(h) === 6;

function envSecret(name: string): string | undefined {
  const file = process.env[`${name}_FILE`];
  if (file) {
    try {
      return readFileSync(file, "utf8").trim();
    } catch {
      return undefined;
    }
  }
  return process.env[name] || undefined;
}

/* ---------------------------------------------------------- stored password */

const PW_KEY = "smtp_password_enc"; // not part of SETTING_DEFS, so the settings API can never return it
const PW_AAD = "smtp:password";

export async function setSmtpPassword(plain: string | null) {
  if (plain === null || plain === "") {
    await run(sql`DELETE FROM settings WHERE key = ${PW_KEY}`);
    return;
  }
  await run(
    sql`INSERT INTO settings(key, value) VALUES (${PW_KEY}, ${JSON.stringify(encrypt(plain, PW_AAD))})
        ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  );
}
export const hasSmtpPassword = async () => !!(await one(sql`SELECT 1 FROM settings WHERE key = ${PW_KEY}`));
async function storedSmtpPassword(): Promise<string | undefined> {
  const row = await one<{ value: string }>(sql`SELECT value FROM settings WHERE key = ${PW_KEY}`);
  if (!row) return undefined;
  try {
    return decrypt(JSON.parse(row.value), PW_AAD);
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------- configuration */

type MailConfig = {
  source: "settings" | "env";
  host: string;
  port: number;
  security: "starttls" | "tls" | "none";
  user?: string;
  pass?: string;
  from: string | { name: string; address: string };
  allowSelfSigned: boolean;
};

async function config(): Promise<MailConfig | null> {
  const s = await getSettings();
  if (s.smtp_host) {
    if (!s.smtp_from) return null;
    return {
      source: "settings",
      host: s.smtp_host,
      port: s.smtp_port,
      security: s.smtp_security,
      user: s.smtp_user || undefined,
      pass: s.smtp_user ? await storedSmtpPassword() : undefined,
      from: { name: s.site_name, address: s.smtp_from },
      allowSelfSigned: s.smtp_allow_self_signed,
    };
  }
  const host = process.env.SMTP_HOST,
    from = process.env.SMTP_FROM;
  if (!host || !from) return null;
  const mode = (process.env.SMTP_SECURITY || "starttls").toLowerCase();
  return {
    source: "env",
    host,
    port: Number(process.env.SMTP_PORT || 587),
    security: mode === "tls" || mode === "none" ? mode : "starttls",
    user: process.env.SMTP_USER || undefined,
    pass: envSecret("SMTP_PASSWORD"),
    from,
    allowSelfSigned: process.env.SMTP_ALLOW_SELF_SIGNED === "true",
  };
}

export const isMailConfigured = async () => (await config()) !== null;
export const mailSource = async (): Promise<"settings" | "env" | "none"> => (await config())?.source ?? "none";

async function transportFor(c: MailConfig) {
  if (c.source === "settings") {
    if (!(SMTP_PORTS as readonly number[]).includes(c.port))
      throw new HttpError(400, "This port is not allowed for SMTP.");
    if (!validSmtpHost(c.host)) throw new HttpError(400, "Enter a valid host name for the mail server.");
  }
  // Resolve once and connect to exactly that address, so DNS can't be swapped between check and use.
  let address: string;
  try {
    address = isIP(c.host) ? c.host : (await lookup(c.host)).address;
  } catch {
    throw new HttpError(502, "The mail server’s host name could not be resolved.");
  }
  if (forbiddenAddress(address)) throw new HttpError(400, "This mail server address is not allowed.");
  return nodemailer.createTransport({
    host: address,
    port: c.port,
    secure: c.security === "tls",
    requireTLS: c.security === "starttls",
    ignoreTLS: c.security === "none",
    auth: c.user ? { user: c.user, pass: c.pass ?? "" } : undefined,
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: !c.allowSelfSigned,
      servername: isIP(c.host) ? undefined : c.host,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

/** Sends one mail. `text` is always included; `html` is the styled variant built by mail-template.ts. */
export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<void> {
  const c = await config();
  if (!c) throw new HttpError(400, "E-mail is not configured.");
  const tr = await transportFor(c);
  try {
    await tr.sendMail({
      from: c.from,
      to,
      subject: subject.replace(/[\r\n]+/g, " ").slice(0, 200),
      text,
      html,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  } finally {
    tr.close();
  }
}

/** Readable, single-line, length-capped reason from an SMTP error (for the admin who runs a test). */
export function mailErrorReason(e: unknown): string {
  const m =
    e instanceof HttpError
      ? e.message
      : e instanceof Error
        ? `${(e as { code?: string }).code ?? ""} ${e.message}`
        : String(e);
  return m
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 240);
}
