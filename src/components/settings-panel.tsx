"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { call } from "@/lib/client-api";
import { msg } from "@/lib/msg";
import { LADDER } from "@/lib/lockout-ladder";
import { formatDuration } from "@/lib/i18n";
import { useToast } from "./ui";
import { useLang, useT } from "./i18n";
import type { Settings } from "@/lib/settings";

type Row = {
  key: keyof Settings;
  title: string;
  desc: string;
  lockedHint?: string;
  /** only shown while this switch is on */
  showIf?: keyof Settings;
  /** only shown while this switch is off */
  hideIf?: keyof Settings;
} & (
  | { kind: "bool" }
  | { kind: "int"; min: number; max: number; unit?: string }
  | { kind: "role" }
  | { kind: "text" }
  | { kind: "lang" }
  | { kind: "line"; type?: string }
  | { kind: "area" }
);

const LEGAL_SECTIONS: { title: string; rows: Row[]; col?: 0 | 1 }[] = [
  {
    title: msg("Published pages"),
    col: 0,
    rows: [
      {
        key: "legal_privacy_enabled",
        kind: "bool",
        title: msg("Privacy notice"),
        desc: msg(
          "Required as soon as the wiki processes personal data — accounts, e-mail addresses, IP addresses in the log (Art. 13 GDPR). Only switch it off if your privacy notice is published elsewhere, for example on your main website, and enter its address below.",
        ),
      },
      {
        key: "legal_privacy_url",
        kind: "line",
        type: "url",
        hideIf: "legal_privacy_enabled",
        title: msg("Privacy notice elsewhere"),
        desc: msg(
          "https address of your privacy notice. The footer, the sign-up form and the other legal pages link there. Empty: no link at all.",
        ),
      },
      {
        key: "legal_terms_enabled",
        kind: "bool",
        title: msg("Terms of use"),
        desc: msg(
          "Not required by law. Useful when other people write in the wiki. Off: the page and its footer link disappear.",
        ),
      },
      {
        key: "legal_imprint_enabled",
        kind: "bool",
        title: msg("Imprint"),
        desc: msg(
          "Required for websites offered on a business basis (§ 5 DDG) and for most others that are not purely personal or family sites (§ 18 MStV). Off: the page disappears and the postal address is no longer needed.",
        ),
      },
    ],
  },
  {
    title: msg("Operator"),
    col: 1,
    rows: [
      {
        key: "operator_name",
        kind: "line",
        title: msg("Name or organisation"),
        desc: msg("Responsible for the wiki (controller under the GDPR, provider under § 5 DDG)."),
      },
      {
        key: "operator_address",
        kind: "area",
        title: msg("Postal address"),
        desc: msg(
          "Only needed for the imprint: a full address that can receive mail (a P.O. box is not enough). Without an imprint, name and e-mail are enough for the privacy notice.",
        ),
      },
      {
        key: "operator_email",
        kind: "line",
        type: "email",
        title: msg("Contact e-mail"),
        desc: msg("Shown on the imprint and privacy pages."),
      },
      {
        key: "operator_phone",
        kind: "line",
        type: "tel",
        title: msg("Phone (optional)"),
        desc: msg("Optional, but it helps people reach you quickly."),
      },
      {
        key: "dpo_contact",
        kind: "area",
        title: msg("Data protection officer (optional)"),
        desc: msg("Name and contact, if your organisation has appointed one."),
      },
      {
        key: "imprint_extra",
        kind: "area",
        title: msg("Additional imprint details (optional)"),
        desc: msg("For example authorised representatives, register court and number, VAT ID."),
      },
    ],
  },
  {
    title: msg("Privacy"),
    col: 0, // right under the switches for the published pages
    rows: [
      {
        key: "ip_retention_days",
        kind: "int",
        min: 1,
        max: 90,
        unit: msg("days"),
        title: msg("Keep IP addresses for"),
        desc: msg(
          "IP addresses in the security log and session list are removed after this time. (They are only known behind a reverse proxy.)",
        ),
      },
      {
        key: "log_retention_days",
        kind: "int",
        min: 30,
        max: 730,
        unit: msg("days"),
        title: msg("Keep security-log entries for"),
        desc: msg("Older entries are deleted automatically every hour."),
      },
      {
        key: "external_media_autoload",
        kind: "bool",
        title: msg("Load external images immediately"),
        desc: msg(
          "Off: images from other servers only load after a click, because loading them sends the reader’s IP address to that server. On: they load right away — mention this in your privacy notice (it is added automatically when you use the template).",
        ),
      },
    ],
  },
];

const SECTIONS: { title: string; rows: Row[] }[] = [
  {
    title: msg("Site"),
    rows: [
      { key: "site_name", kind: "text", title: msg("Site name"), desc: msg("Shown in the header and in e-mails.") },
    ],
  },
  {
    title: msg("Access"),
    rows: [
      {
        key: "allow_registration",
        kind: "bool",
        title: msg("Allow self-registration"),
        desc: msg(
          "Anyone who can reach this wiki can create their own account. Turn off to invite people by creating accounts yourself.",
        ),
      },
      {
        key: "registration_role",
        kind: "role",
        title: msg("Role for new sign-ups"),
        desc: msg("Editors can add and edit pages. Viewers can only read, even when signed in."),
      },
      {
        key: "public_read",
        kind: "bool",
        title: msg("Let signed-out visitors read"),
        desc: msg("When off, the whole wiki requires an account — nothing is readable without signing in."),
      },
    ],
  },
];

const SECURITY_SECTIONS: { title: string; rows: Row[]; note?: string }[] = [
  {
    title: msg("Two-factor authentication by role"),
    note: msg(
      "People in a role that requires it must set up an authenticator app before they can do anything else. You can only change this for roles below your own; the owner can change it for every role.",
    ),
    rows: [
      {
        key: "require_2fa_admin",
        kind: "bool",
        title: msg("Required for administrators"),
        desc: msg("Applies to all administrators, including the owner."),
      },
      {
        key: "require_2fa_editor",
        kind: "bool",
        title: msg("Required for editors"),
        desc: msg("People who can add and edit pages."),
      },
      {
        key: "require_2fa_viewer",
        kind: "bool",
        title: msg("Required for viewers"),
        desc: msg("People who can only read."),
      },
    ],
  },
  {
    title: msg("Password policy"),
    note: msg(
      "Applies to new and changed passwords; existing passwords keep working. Long passphrases are stronger than short passwords with symbols, so prefer length over composition rules.",
    ),
    rows: [
      {
        key: "password_min_length",
        kind: "int",
        min: 10,
        max: 64,
        unit: msg("characters"),
        title: msg("Minimum length"),
        desc: msg("Longer is stronger."),
      },
      {
        key: "password_min_digits",
        kind: "int",
        min: 0,
        max: 10,
        title: msg("Digits"),
        desc: msg("Minimum number of digits (0–9). 0 = no requirement."),
      },
      {
        key: "password_min_special",
        kind: "int",
        min: 0,
        max: 10,
        title: msg("Special characters"),
        desc: msg(
          "Minimum number of characters that are neither letters nor digits, e.g. ! ? # % -. 0 = no requirement.",
        ),
      },
      {
        key: "password_min_upper",
        kind: "int",
        min: 0,
        max: 10,
        title: msg("Upper-case letters"),
        desc: msg("Minimum number of capital letters. 0 = no requirement."),
      },
      {
        key: "password_min_lower",
        kind: "int",
        min: 0,
        max: 10,
        title: msg("Lower-case letters"),
        desc: msg("Minimum number of small letters. 0 = no requirement."),
      },
    ],
  },
  {
    title: msg("Sign-in security"),
    rows: [
      {
        key: "allow_password_reset",
        kind: "bool",
        title: msg("Allow password reset by e-mail"),
        desc: msg("Needs working e-mail settings. Reset links expire after 30 minutes."),
      },
      {
        key: "max_login_attempts",
        kind: "int",
        min: 3,
        max: 20,
        title: msg("Failed attempts before lock-out"),
        desc: msg("Counted per account within 15 minutes. Each further lock-out lasts longer (see below)."),
      },
      {
        key: "session_hours",
        kind: "int",
        min: 1,
        max: 720,
        unit: msg("hours"),
        title: msg("Session length"),
        desc: msg("How long someone stays signed in. Applies to new sessions."),
      },
    ],
  },
];

const BACKUP_SECTIONS: { title: string; rows: Row[]; note?: string }[] = [
  {
    title: msg("Backup settings"),
    rows: [
      {
        key: "backup_enabled",
        kind: "bool",
        title: msg("Make backups"),
        desc: msg(
          "On: a full backup (all pages with history, trash, accounts, settings, files) at a fixed interval, and “Back up now”. Off: no new backups; existing ones stay and can still be restored.",
        ),
      },
      {
        key: "backup_interval_hours",
        showIf: "backup_enabled",
        kind: "int",
        min: 1,
        max: 168,
        unit: msg("hours"),
        title: msg("Interval"),
        desc: msg("Time between two automatic backups. 24 = daily, 168 = weekly."),
      },
      {
        key: "backup_keep",
        showIf: "backup_enabled",
        kind: "int",
        min: 1,
        max: 100,
        unit: msg("backups"),
        title: msg("Keep"),
        desc: msg(
          "How many automatic backups are kept; older ones are deleted. Manual and uploaded backups stay until you delete them; of the safety copies made before a restore or import, the newest 5 are kept.",
        ),
      },
    ],
  },
];

export function SettingsPanel({
  initial,
  group = "general",
  locked = [],
}: {
  initial: Settings;
  group?: "general" | "security" | "legal" | "backups";
  locked?: (keyof Settings)[];
}) {
  const sections: { title: string; rows: Row[]; note?: string; col?: 0 | 1 }[] =
    group === "legal"
      ? LEGAL_SECTIONS
      : group === "security"
        ? SECURITY_SECTIONS
        : group === "backups"
          ? BACKUP_SECTIONS
          : SECTIONS;
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const [s, setS] = useState(initial);
  const toast = useToast();
  const setNote = toast.show;
  const save = async (key: keyof Settings, value: unknown) => {
    const r = await call<Settings>("/api/settings", "PUT", { [key]: value });
    if (r.ok) {
      setS(r.data as Settings);
      setNote({ ok: true, text: t("Saved.") });
      router.refresh();
    } else {
      setNote({ ok: false, text: t(r.data.error ?? "Couldn’t save.") });
      setS(initial);
    }
  };
  // Two columns that fill independently, so a short panel never waits below a tall neighbour.
  // A section goes to its fixed column, or else to the one that is shorter so far — estimated
  // from all its rows, shown or not, so flipping a switch never moves panels around.
  const columns: (typeof sections)[] = [[], []];
  const heights = [0, 0];
  for (const sec of sections) {
    const h = 2 + sec.rows.reduce((a, r) => a + 1.5 + t(r.desc).length / 55, 0);
    const c = sec.col ?? (heights[0] <= heights[1] ? 0 : 1);
    columns[c].push(sec);
    heights[c] += h;
  }
  return (
    <div className="settings-cols">
      {toast.node}
      {columns.map((col, ci) => (
        <div key={ci} className="settings-col">
          {col.map((sec) => (
            <section key={sec.title} className="panel">
              <h2 className="section-title">{t(sec.title)}</h2>
              {sec.note && <p className="hint section-note">{t(sec.note)}</p>}
              {sec.rows.map((r) => {
                if ((r.showIf && !s[r.showIf]) || (r.hideIf && s[r.hideIf])) return null;
                const id = `set-${r.key}`;
                const isLocked = locked.includes(r.key);
                return (
                  <div className="switch" key={r.key} data-locked={isLocked ? "1" : undefined}>
                    {r.kind === "bool" && (
                      <input
                        id={id}
                        type="checkbox"
                        role="switch"
                        checked={s[r.key] as boolean}
                        disabled={isLocked}
                        aria-describedby={isLocked ? `${id}-lock` : undefined}
                        onChange={(e) => {
                          setS({ ...s, [r.key]: e.target.checked });
                          void save(r.key, e.target.checked);
                        }}
                      />
                    )}
                    <div style={{ flex: 1 }}>
                      <label className="t" htmlFor={id}>
                        {t(r.title)}
                      </label>
                      <div className="d">{t(r.desc)}</div>
                      {isLocked && (
                        <div className="d lock-note" id={`${id}-lock`}>
                          {t("Only the owner can change this.")}
                        </div>
                      )}
                    </div>
                    {r.kind === "int" && (
                      <span className="row nowrap">
                        <input
                          id={id}
                          className="input"
                          style={{ width: "5.5rem" }}
                          type="number"
                          min={r.min}
                          max={r.max}
                          defaultValue={s[r.key] as number}
                          disabled={isLocked}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isInteger(v) && v !== s[r.key]) void save(r.key, v);
                          }}
                        />
                        {r.unit && <span className="hint">{t(r.unit)}</span>}
                      </span>
                    )}
                    {r.kind === "role" && (
                      <select
                        id={id}
                        className="input"
                        style={{ width: "9rem" }}
                        value={s.registration_role}
                        onChange={(e) => void save("registration_role", e.target.value)}
                      >
                        <option value="editor">{t("Editor")}</option>
                        <option value="viewer">{t("Viewer")}</option>
                      </select>
                    )}
                    {r.kind === "lang" && (
                      <select
                        id={id}
                        className="input"
                        style={{ width: "9rem" }}
                        value={s.language}
                        onChange={(e) => void save("language", e.target.value)}
                      >
                        <option value="de">Deutsch</option>
                        <option value="en">English</option>
                      </select>
                    )}
                    {r.kind === "line" && (
                      <input
                        id={id}
                        className="input"
                        style={{ width: "16rem" }}
                        type={r.type ?? "text"}
                        defaultValue={s[r.key] as string}
                        maxLength={254}
                        onBlur={(e) => {
                          if (e.target.value.trim() !== s[r.key]) void save(r.key, e.target.value);
                        }}
                      />
                    )}
                    {r.kind === "area" && (
                      <textarea
                        id={id}
                        className="input"
                        style={{ width: "16rem", minHeight: "5rem" }}
                        defaultValue={s[r.key] as string}
                        maxLength={1000}
                        onBlur={(e) => {
                          if (e.target.value.trim() !== s[r.key]) void save(r.key, e.target.value);
                        }}
                      />
                    )}
                    {r.kind === "text" && (
                      <input
                        id={id}
                        className="input"
                        style={{ width: "13rem" }}
                        defaultValue={s.site_name}
                        maxLength={60}
                        onBlur={(e) => {
                          if (e.target.value.trim() && e.target.value !== s.site_name)
                            void save("site_name", e.target.value);
                        }}
                      />
                    )}
                  </div>
                );
              })}
              {sec.title === "Sign-in security" && (
                <div className="ladder">
                  <span className="hint">{t("Lock-out steps")}:</span>
                  <ol>
                    {LADDER.map((sec, i) => (
                      <li key={i}>{formatDuration(sec, lang)}</li>
                    ))}
                  </ol>
                  <span className="hint">
                    {t(
                      "A successful sign-in or an administrator unlock resets the steps. After a day without a new lock-out they start again from the first step.",
                    )}
                  </span>
                </div>
              )}
            </section>
          ))}
        </div>
      ))}
    </div>
  );
}
