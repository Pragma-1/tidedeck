import { all, run, sql, tx } from "./db";

type Def =
  | { type: "bool"; default: boolean }
  | { type: "int"; default: number; min: number; max: number }
  | { type: "enum"; default: string; values: readonly string[] }
  | { type: "string"; default: string; max: number }
  | { type: "text"; default: string; max: number; multiline?: boolean; email?: boolean; url?: boolean };

export const SETTING_DEFS = {
  site_name: { type: "string", default: "Tidewiki", max: 60 },
  language: { type: "enum", default: "de", values: ["de", "en"] },
  allow_registration: { type: "bool", default: false },
  registration_role: { type: "enum", default: "editor", values: ["editor", "viewer"] },
  allow_password_reset: { type: "bool", default: true },
  require_2fa_admin: { type: "bool", default: false },
  require_2fa_editor: { type: "bool", default: false },
  require_2fa_viewer: { type: "bool", default: false },
  public_read: { type: "bool", default: true },
  session_hours: { type: "int", default: 168, min: 1, max: 720 },
  max_login_attempts: { type: "int", default: 5, min: 3, max: 20 },
  password_min_length: { type: "int", default: 12, min: 10, max: 64 },
  password_min_digits: { type: "int", default: 0, min: 0, max: 10 },
  password_min_special: { type: "int", default: 0, min: 0, max: 10 },
  password_min_upper: { type: "int", default: 0, min: 0, max: 10 },
  password_min_lower: { type: "int", default: 0, min: 0, max: 10 },
  // e-mail (overrides SMTP_* from .env when a host is set here)
  smtp_host: { type: "text", default: "", max: 253 },
  smtp_port: { type: "int", default: 587, min: 1, max: 65535 },
  smtp_security: { type: "enum", default: "starttls", values: ["starttls", "tls", "none"] },
  smtp_user: { type: "text", default: "", max: 254 },
  smtp_from: { type: "text", default: "", max: 254 },
  smtp_allow_self_signed: { type: "bool", default: false },
  // privacy / retention
  log_retention_days: { type: "int", default: 180, min: 30, max: 730 },
  ip_retention_days: { type: "int", default: 7, min: 1, max: 90 },
  external_media_autoload: { type: "bool", default: false },
  // legal pages: the privacy notice is always on; terms and imprint can be switched off (e.g. a private wiki)
  legal_terms_enabled: { type: "bool", default: true },
  legal_imprint_enabled: { type: "bool", default: true },
  legal_privacy_enabled: { type: "bool", default: true },
  // where the privacy notice is when it isn't published here (e.g. on the operator's main site)
  legal_privacy_url: { type: "text", default: "", max: 300, url: true },
  // backups
  backup_enabled: { type: "bool", default: true },
  backup_interval_hours: { type: "int", default: 24, min: 1, max: 168 },
  backup_keep: { type: "int", default: 14, min: 1, max: 100 },
  backup_target: { type: "enum", default: "local", values: ["local", "s3"] },
  // folder inside the container for the "local" target; empty = WIKI_BACKUP_DIR (checked in backup.ts)
  backup_local_dir: { type: "text", default: "", max: 255 },
  backup_s3_endpoint: { type: "text", default: "", max: 300 },
  backup_s3_region: { type: "text", default: "us-east-1", max: 40 },
  backup_s3_bucket: { type: "text", default: "", max: 63 },
  backup_s3_prefix: { type: "text", default: "tidewiki/", max: 330 },
  backup_s3_access_key: { type: "text", default: "", max: 128 },
  backup_s3_path_style: { type: "bool", default: true },
  // operator details for the legal pages (Impressum § 5 DDG, Art. 13 GDPR controller)
  operator_name: { type: "text", default: "", max: 120 },
  operator_address: { type: "text", default: "", max: 300, multiline: true },
  operator_email: { type: "text", default: "", max: 254, email: true },
  operator_phone: { type: "text", default: "", max: 40 },
  dpo_contact: { type: "text", default: "", max: 300, multiline: true },
  imprint_extra: { type: "text", default: "", max: 1000, multiline: true },
} as const satisfies Record<string, Def>;

export type SettingKey = keyof typeof SETTING_DEFS;
export type Settings = {
  site_name: string;
  language: "de" | "en";
  allow_registration: boolean;
  registration_role: "editor" | "viewer";
  allow_password_reset: boolean;
  require_2fa_admin: boolean;
  require_2fa_editor: boolean;
  require_2fa_viewer: boolean;
  public_read: boolean;
  session_hours: number;
  max_login_attempts: number;
  password_min_length: number;
  password_min_digits: number;
  password_min_special: number;
  password_min_upper: number;
  password_min_lower: number;
  smtp_host: string;
  smtp_port: number;
  smtp_security: "starttls" | "tls" | "none";
  smtp_user: string;
  smtp_from: string;
  smtp_allow_self_signed: boolean;
  log_retention_days: number;
  ip_retention_days: number;
  external_media_autoload: boolean;
  legal_terms_enabled: boolean;
  legal_imprint_enabled: boolean;
  legal_privacy_enabled: boolean;
  legal_privacy_url: string;
  backup_enabled: boolean;
  backup_interval_hours: number;
  backup_keep: number;
  backup_target: "local" | "s3";
  backup_local_dir: string;
  backup_s3_endpoint: string;
  backup_s3_region: string;
  backup_s3_bucket: string;
  backup_s3_prefix: string;
  backup_s3_access_key: string;
  backup_s3_path_style: boolean;
  operator_name: string;
  operator_address: string;
  operator_email: string;
  operator_phone: string;
  dpo_contact: string;
  imprint_extra: string;
};

function parse(def: Def, raw: string): string | number | boolean {
  try {
    const v = JSON.parse(raw);
    return coerce(def, v) ?? def.default;
  } catch {
    return def.default;
  }
}

/** Returns a validated value or null when the input doesn't fit the definition. */
export function coerce(def: Def, v: unknown): string | number | boolean | null {
  switch (def.type) {
    case "bool":
      return typeof v === "boolean" ? v : null;
    case "int":
      return typeof v === "number" && Number.isInteger(v) && v >= def.min && v <= def.max ? v : null;
    case "enum":
      return typeof v === "string" && def.values.includes(v) ? v : null;
    case "string": {
      if (typeof v !== "string") return null;
      const t = v.trim();
      return t.length >= 1 && t.length <= def.max && !/[\u0000-\u001f<>]/.test(t) ? t : null;
    }
    case "text": {
      // optional free text (may be empty); newlines only where the field is multi-line
      if (typeof v !== "string") return null;
      const t = v.replace(/\r\n?/g, "\n").trim();
      if (t.length > def.max) return null;
      if ((def.multiline ? /[\u0000-\u0009\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(t)) return null;
      if (def.email && t && !/^[^\s@<>"'`\\,;:()[\]]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(t)) return null;
      if (def.url && t) return httpsUrl(t);
      return t;
    }
  }
}

/**
 * Where links to the privacy notice go: the page here, the operator's own address when it's
 * published elsewhere, or nowhere (then the links are left out).
 */
export const privacyHref = (cfg: Pick<Settings, "legal_privacy_enabled" | "legal_privacy_url">): string | null =>
  cfg.legal_privacy_enabled ? "/privacy" : cfg.legal_privacy_url || null;

/** What page rendering takes from the settings. */
export const renderSettings = (cfg: Settings) => ({
  autoloadExternal: cfg.external_media_autoload,
  privacyHref: privacyHref(cfg),
});

/** An https address that's safe to put in a link: no credentials, no spaces, a real host. */
function httpsUrl(t: string): string | null {
  if (/\s/.test(t)) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    !/^[a-z0-9.-]+$/i.test(u.hostname) ||
    !u.hostname.includes(".")
  )
    return null;
  return u.href.length <= 300 ? u.href : null;
}

export async function getSettings(): Promise<Settings> {
  const rows = await all<{ key: string; value: string }>(sql`SELECT key, value FROM settings`);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(SETTING_DEFS) as [SettingKey, Def][]) {
    const raw = map.get(k);
    out[k] = raw === undefined ? def.default : parse(def, raw);
  }
  return out as Settings;
}

/** Whitelist-only update: unknown keys and invalid values are rejected, never stored. */
export async function updateSettings(
  input: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const entries = Object.entries(input);
  if (entries.length === 0) return { ok: false, error: "No settings supplied." };
  const clean: [string, unknown][] = [];
  for (const [k, v] of entries) {
    const def = (SETTING_DEFS as Record<string, Def>)[k];
    if (!Object.prototype.hasOwnProperty.call(SETTING_DEFS, k) || !def)
      return { ok: false, error: `Unknown setting: ${k}` };
    const c = coerce(def, v);
    if (c === null) return { ok: false, error: `Invalid value for ${k}.` };
    clean.push([k, c]);
  }
  await tx(async () => {
    for (const [k, v] of clean)
      await run(
        sql`INSERT INTO settings(key, value) VALUES (${k}, ${JSON.stringify(v)})
            ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      );
  });
  return { ok: true };
}

/**
 * Settings as sent to a browser. The S3 connection details (endpoint, bucket, access key id) are
 * the owner's business: other administrators get blanks.
 */
export function settingsForClient(s: Settings, isOwner: boolean): Settings {
  if (isOwner) return s;
  return {
    ...s,
    backup_s3_endpoint: "",
    backup_s3_region: "",
    backup_s3_bucket: "",
    backup_s3_prefix: "",
    backup_s3_access_key: "",
  };
}
