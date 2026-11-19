"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  KeyRound,
  ShieldCheck,
  ShieldOff,
  Copy,
  Download,
  Trash2,
  Smartphone,
  Plus,
  MonitorSmartphone,
  LogOut,
  UserRound,
  Pencil,
} from "lucide-react";
import { call } from "@/lib/client-api";
import type { PasswordPolicy } from "@/lib/password-policy";
import { Actions, Field, Notice, PasswordInput, useToast } from "./ui";
import { PasswordRules } from "./password-rules";
import { useConfirm } from "./confirm";
import { useDate, useT } from "./i18n";

const MAX_DEVICES = 10;

export type Device = { id: number; name: string; created_at: number; last_used_at: number | null };
export type SessionInfo = {
  handle: string;
  current: boolean;
  created_at: number;
  last_seen: number;
  ip: string | null;
  user_agent: string | null;
};

/* ------------------------------------------------------------------ profile */

function ProfileForm({ username, email }: { username: string; email: string }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = useState({ username, email });
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = f.username.trim() !== username || f.email.trim() !== email;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await call("/api/account/profile", "PUT", { ...f, password });
    setBusy(false);
    if (r.ok) {
      setMsg({ ok: true, text: t("Profile saved.") });
      setPassword("");
      router.refresh();
    } else setMsg({ ok: false, text: t(r.data.error ?? "Something went wrong.") });
  };
  return (
    <form onSubmit={submit} className="panel">
      <h2 className="section-title">
        <UserRound size={18} aria-hidden /> {t("Profile")}
      </h2>
      {msg && <Notice kind={msg.ok ? "info" : "error"}>{msg.text}</Notice>}
      <Field id="pf-name" label={t("Username")}>
        <input
          className="input"
          id="pf-name"
          value={f.username}
          onChange={(e) => setF({ ...f, username: e.target.value })}
          autoComplete="username"
          required
          minLength={3}
          maxLength={32}
          pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{2,31}"
          autoCapitalize="none"
          spellCheck={false}
        />
      </Field>
      <Field
        id="pf-mail"
        label={t("E-mail")}
        hint={t("Used for password resets. If you change it, the old address gets a notice.")}
      >
        <input
          className="input"
          id="pf-mail"
          type="email"
          value={f.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
          autoComplete="email"
          required
          maxLength={254}
        />
      </Field>
      {changed && (
        <Field id="pf-pw" label={t("Confirm with your password")}>
          <PasswordInput id="pf-pw" value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
      )}
      <Actions>
        <button className="btn" disabled={busy || !changed}>
          {busy ? t("Saving…") : t("Save profile")}
        </button>
      </Actions>
    </form>
  );
}

/* ----------------------------------------------------------------- password */

function PasswordForm({ policy }: { policy: PasswordPolicy }) {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await call("/api/account/password", "POST", { current, password });
    setBusy(false);
    if (r.ok) {
      setMsg({ ok: true, text: t("Password changed. Your other sessions were signed out.") });
      setCurrent("");
      setPassword("");
    } else setMsg({ ok: false, text: t(r.data.error ?? "Couldn’t change the password.") });
  };
  return (
    <form onSubmit={submit} className="panel">
      <h2 className="section-title">
        <KeyRound size={18} aria-hidden /> {t("Password")}
      </h2>
      {msg && <Notice kind={msg.ok ? "info" : "error"}>{msg.text}</Notice>}
      <Field id="cur" label={t("Current password")}>
        <PasswordInput id="cur" value={current} onChange={setCurrent} autoComplete="current-password" />
      </Field>
      <Field
        id="new"
        label={t("New password")}
        extra={<PasswordRules id="new-rules" value={password} policy={policy} />}
      >
        <PasswordInput
          id="new"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          describedBy="new-rules"
        />
      </Field>
      <Actions>
        <button className="btn" disabled={busy}>
          {busy ? t("Saving…") : t("Change password")}
        </button>
      </Actions>
    </form>
  );
}

/* --------------------------------------------------------------- two-factor */

function RecoveryCodes({ codes }: { codes: string[] }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <Notice>{t("Save these recovery codes somewhere safe. Each works once, and they’re shown only now.")}</Notice>
      <div className="codes" aria-label={t("Recovery codes")}>
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <p>
        <button
          type="button"
          className="btn ghost sm"
          onClick={async () => {
            await navigator.clipboard?.writeText(codes.join("\n"));
            setCopied(true);
          }}
        >
          <Copy size={14} aria-hidden />
          {copied ? t("Copied") : t("Copy codes")}
        </button>
      </p>
    </div>
  );
}

type Step = "idle" | "password" | "scan" | "codes" | "disable" | "regen" | { remove: Device } | { rename: Device };

function TwoFactor({ devices, required, codesLeft }: { devices: Device[]; required: boolean; codesLeft: number }) {
  const t = useT();
  const date = useDate();
  const router = useRouter();
  const enabled = devices.length > 0;
  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const run = async (fn: () => ReturnType<typeof call>, ok: (d: Record<string, unknown>) => void) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.ok) ok(r.data);
    else setError(t(r.data.error ?? "Something went wrong."));
  };
  const cancel = () => {
    setStep("idle");
    setPassword("");
    setSecret("");
    setQr("");
    setCode("");
    setName("");
    setError(null);
  };
  const needsPassword =
    step === "password" || step === "disable" || step === "regen" || (typeof step === "object" && "remove" in step);
  const removing = typeof step === "object" && "remove" in step ? step.remove : null;
  const renaming = typeof step === "object" && "rename" in step ? step.rename : null;
  const lastRequired = required && devices.length === 1;

  return (
    <section className="panel">
      {toast.node}
      <h2 className="section-title">
        {enabled ? <ShieldCheck size={18} aria-hidden /> : <ShieldOff size={18} aria-hidden />}{" "}
        {t("Two-factor authentication")}
      </h2>
      {required && !enabled && (
        <Notice kind="error">
          {t("Two-factor authentication is required for your role. Set it up to keep using the wiki.")}
        </Notice>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {step === "codes" ? (
        <>
          <RecoveryCodes codes={codes} />
          <Actions>
            <button
              className="btn"
              onClick={() => {
                cancel();
                router.refresh();
              }}
            >
              {t("I’ve saved them")}
            </button>
          </Actions>
        </>
      ) : (
        <>
          <p>
            {enabled ? (
              <>
                {t("Two-factor authentication is on.")} {t("Recovery codes left: {n}", { n: codesLeft })}
                {required && <> · {t("Required for your role.")}</>}
              </>
            ) : (
              t(
                "Add a second step at sign-in with an authenticator app (TOTP), such as Aegis, 2FAS, Authy or a password manager.",
              )
            )}
          </p>
          {enabled && (
            <ul className="device-list" aria-label={t("Authenticator devices")}>
              {devices.map((d) => (
                <li key={d.id}>
                  <Smartphone size={18} aria-hidden />
                  <span className="dl-main">
                    <strong>{d.name}</strong>
                    <span className="meta">
                      {t("added {date}", { date: date(d.created_at) })} ·{" "}
                      {d.last_used_at ? t("last used {date}", { date: date(d.last_used_at) }) : t("not used yet")}
                    </span>
                  </span>
                  <span className="row">
                    <button
                      type="button"
                      className="btn ghost sm icon-only"
                      title={t("Rename")}
                      aria-label={t("Rename {name}", { name: d.name })}
                      onClick={() => {
                        cancel();
                        setName(d.name);
                        setStep({ rename: d });
                      }}
                    >
                      <Pencil size={15} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="btn danger sm"
                      disabled={lastRequired}
                      title={lastRequired ? t("Required for your role: add another device first.") : undefined}
                      onClick={() => {
                        cancel();
                        setStep({ remove: d });
                      }}
                    >
                      <Trash2 size={15} aria-hidden />
                      {t("Remove")}
                    </button>
                  </span>
                </li>
              ))}
              {step !== "password" && step !== "scan" && (
                <li className="device-add">
                  <button
                    type="button"
                    className="device-add-btn"
                    disabled={devices.length >= MAX_DEVICES}
                    onClick={() => {
                      cancel();
                      setStep("password");
                    }}
                  >
                    <Plus size={18} aria-hidden />
                    <span>
                      <strong>{t("Register a new device")}</strong>
                      <span className="meta">
                        {devices.length >= MAX_DEVICES
                          ? t("You can register at most {n} authenticator devices.", { n: MAX_DEVICES })
                          : t("Another phone, a password manager or a replacement for an old device.")}
                      </span>
                    </span>
                  </button>
                </li>
              )}
            </ul>
          )}
          {enabled && lastRequired && step === "idle" && (
            <p className="hint">
              {t("To replace your only device, register the new one first, then remove the old one.")}
            </p>
          )}
          {step === "idle" &&
            (enabled ? (
              <Actions>
                {!required && (
                  <button className="btn danger" onClick={() => setStep("disable")}>
                    {t("Turn off")}
                  </button>
                )}
                <button className="btn ghost" onClick={() => setStep("regen")}>
                  {t("New recovery codes")}
                </button>
              </Actions>
            ) : (
              <Actions>
                <button className="btn" onClick={() => setStep("password")}>
                  {t("Set up two-factor")}
                </button>
              </Actions>
            ))}
          {renaming && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  () => call(`/api/account/2fa/devices/${renaming.id}`, "PATCH", { name }),
                  () => {
                    cancel();
                    toast.show({ ok: true, text: t("Saved.") });
                    router.refresh();
                  },
                );
              }}
            >
              <Field id="dev-name" label={t("Device name")}>
                <input
                  className="input"
                  id="dev-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  required
                  autoFocus
                />
              </Field>
              <Actions>
                <button type="button" className="btn ghost" onClick={cancel}>
                  {t("Cancel")}
                </button>
                <button className="btn" disabled={busy}>
                  {t("Save")}
                </button>
              </Actions>
            </form>
          )}
          {needsPassword && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (step === "password")
                  void run(
                    () => call<{ qr: string; secret: string }>("/api/account/2fa/setup", "POST", { password }),
                    (d) => {
                      setQr(d.qr as string);
                      setSecret(d.secret as string);
                      setPassword("");
                      setName(enabled ? "" : t("Authenticator"));
                      setStep("scan");
                    },
                  );
                if (step === "disable")
                  void run(
                    () => call("/api/account/2fa/disable", "POST", { password }),
                    () => {
                      cancel();
                      router.refresh();
                    },
                  );
                if (step === "regen")
                  void run(
                    () => call<{ recoveryCodes: string[] }>("/api/account/2fa/recovery", "POST", { password }),
                    (d) => {
                      setCodes(d.recoveryCodes as string[]);
                      setPassword("");
                      setStep("codes");
                    },
                  );
                if (removing)
                  void run(
                    () => call(`/api/account/2fa/devices/${removing.id}`, "DELETE", { password }),
                    () => {
                      cancel();
                      toast.show({ ok: true, text: t("Device removed.") });
                      router.refresh();
                    },
                  );
              }}
            >
              {removing && (
                <p>
                  {devices.length === 1
                    ? t(
                        "Removing your only device turns two-factor authentication off and deletes your recovery codes.",
                      )
                    : t("“{name}” can no longer be used to sign in.", { name: removing.name })}
                </p>
              )}
              {step === "disable" && <p>{t("This removes all devices and recovery codes.")}</p>}
              {step === "password" && enabled && (
                <p>
                  {t(
                    "Confirm with your password to register another authenticator. Your existing devices and recovery codes stay valid.",
                  )}
                </p>
              )}
              <Field id="pw2" label={t("Confirm with your password")}>
                <PasswordInput id="pw2" value={password} onChange={setPassword} autoComplete="current-password" />
              </Field>
              <Actions>
                <button type="button" className="btn ghost" onClick={cancel}>
                  {t("Cancel")}
                </button>
                <button className={`btn ${step === "disable" || removing ? "danger solid" : ""}`} disabled={busy}>
                  {removing ? t("Remove device") : t("Continue")}
                </button>
              </Actions>
            </form>
          )}
          {step === "scan" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  () => call<{ recoveryCodes: string[] | null }>("/api/account/2fa/enable", "POST", { code, name }),
                  (d) => {
                    setCode("");
                    if (Array.isArray(d.recoveryCodes)) {
                      setCodes(d.recoveryCodes as string[]);
                      setStep("codes");
                    } else {
                      cancel();
                      toast.show({ ok: true, text: t("Device added.") });
                      router.refresh();
                    }
                  },
                );
              }}
            >
              <p>{t("Scan this QR code with your authenticator app, then enter the 6-digit code it shows.")}</p>
              <img className="qr" src={qr} alt={t("QR code for your authenticator app")} width={192} height={192} />
              <p className="hint">{t("Can’t scan? Enter this key manually:")}</p>
              <p className="secret">{secret}</p>
              <Field
                id="dev-new-name"
                label={t("Device name")}
                hint={t("So you can tell your devices apart, e.g. “Phone” or “Password manager”.")}
              >
                <input
                  className="input"
                  id="dev-new-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                  required
                />
              </Field>
              <Field id="totp" label={t("6-digit code")}>
                <input
                  className="input"
                  id="totp"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  autoFocus
                />
              </Field>
              <Actions>
                <button type="button" className="btn ghost" onClick={cancel}>
                  {t("Cancel")}
                </button>
                <button className="btn" disabled={busy}>
                  {enabled ? t("Add device") : t("Turn on")}
                </button>
              </Actions>
            </form>
          )}
        </>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- sessions */

/** "Firefox · Windows" from a user-agent string; only for display. */
function describeUa(ua: string | null, unknown: string): string {
  if (!ua) return unknown;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : /curl|wget|python|node/i.test(ua)
              ? ua.split(/[\s/]/)[0]
              : "";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iOS/.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return [browser, os].filter(Boolean).join(" · ") || ua.slice(0, 60);
}

function Sessions({ sessions }: { sessions: SessionInfo[] }) {
  const t = useT();
  const date = useDate();
  const router = useRouter();
  const toast = useToast();
  const [dialog, confirm] = useConfirm();
  const [busy, setBusy] = useState(false);
  const others = sessions.filter((s) => !s.current).length;
  const revoke = async (s: SessionInfo) => {
    if (
      s.current &&
      !(await confirm({
        title: t("Sign out here?"),
        body: t("This is the session you are using right now. You will be signed out."),
        confirmLabel: t("Sign out"),
      }))
    )
      return;
    setBusy(true);
    const r = await call<{ current: boolean }>("/api/account/sessions", "POST", { action: "revoke", id: s.handle });
    setBusy(false);
    if (!r.ok) {
      toast.show({ ok: false, text: t(r.data.error ?? "Something went wrong.") });
      return;
    }
    if (r.data.current) {
      router.push("/login");
      router.refresh();
      return;
    }
    toast.show({ ok: true, text: t("Session signed out.") });
    router.refresh();
  };
  const revokeOthers = async () => {
    if (
      !(await confirm({
        title: t("Sign out all other sessions?"),
        body: t("Every other browser and device has to sign in again. This one stays signed in."),
        confirmLabel: t("Sign out others"),
        danger: true,
      }))
    )
      return;
    setBusy(true);
    const r = await call<{ revoked: number }>("/api/account/sessions", "POST", { action: "revoke_others" });
    setBusy(false);
    if (!r.ok) {
      toast.show({ ok: false, text: t(r.data.error ?? "Something went wrong.") });
      return;
    }
    toast.show({ ok: true, text: t("{n} sessions signed out.", { n: r.data.revoked }) });
    router.refresh();
  };
  return (
    <section className="panel span-all">
      {toast.node}
      {dialog}
      <div className="row between">
        <h2 className="section-title">
          <MonitorSmartphone size={18} aria-hidden /> {t("Active sessions")}
        </h2>
        <button
          type="button"
          className="btn danger sm"
          disabled={busy || others === 0}
          onClick={() => void revokeOthers()}
        >
          <LogOut size={15} aria-hidden />
          {t("Sign out all others")}
        </button>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>{t("Device")}</th>
              <th>{t("Last active")}</th>
              <th>{t("Signed in")}</th>
              <th>{t("IP address")}</th>
              <th>
                <span className="sr-only">{t("Actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.handle}>
                <td>
                  {describeUa(s.user_agent, t("unknown"))}
                  {s.current && (
                    <>
                      {" "}
                      <span className="badge">{t("this device")}</span>
                    </>
                  )}
                </td>
                <td className="nowrap">{date(s.last_seen)}</td>
                <td className="nowrap">{date(s.created_at)}</td>
                <td className="mono">{s.ip ?? <span className="hint">{t("not stored")}</span>}</td>
                <td className="right">
                  <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void revoke(s)}>
                    <LogOut size={14} aria-hidden />
                    {t("Sign out")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ privacy */

function PrivacyPanel({ isOwner }: { isOwner: boolean }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const erase = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call("/api/account/delete", "POST", { password, confirm });
    setBusy(false);
    if (r.ok) {
      router.push("/");
      router.refresh();
    } else setError(t(r.data.error ?? "Something went wrong."));
  };
  return (
    <section className="panel">
      <h2 className="section-title">
        <Download size={18} aria-hidden /> {t("Your data")}
      </h2>
      <p>
        {t(
          "Download everything this wiki stores about you: account details, active sessions, your security-log entries and the pages you wrote.",
        )}
      </p>
      <Actions>
        <a className="btn ghost" href="/api/account/export" download>
          <Download size={16} aria-hidden />
          {t("Download my data (JSON)")}
        </a>
      </Actions>
      <div className="danger-zone">
        <h3>
          <Trash2 size={17} aria-hidden /> {t("Delete my account")}
        </h3>
        <p>
          {t(
            "This permanently deletes your account and all personal data: name, e-mail, password, two-factor setup, sessions and your security-log entries. Pages you wrote or edited stay in the wiki, because they belong to everyone — they will show “deleted account” as author.",
          )}
        </p>
        {isOwner && (
          <Notice kind="error">
            {t("You own this wiki. Hand ownership to another administrator in Settings first.")}
          </Notice>
        )}
        {!open ? (
          <Actions>
            <button type="button" className="btn danger" disabled={isOwner} onClick={() => setOpen(true)}>
              {t("Delete my account…")}
            </button>
          </Actions>
        ) : (
          <form onSubmit={erase}>
            {error && <Notice kind="error">{error}</Notice>}
            <Field id="delpw" label={t("Confirm with your password")}>
              <PasswordInput id="delpw" value={password} onChange={setPassword} autoComplete="current-password" />
            </Field>
            <label className="check">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} required />{" "}
              {t("I understand that this can’t be undone.")}
            </label>
            <Actions>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setOpen(false);
                  setPassword("");
                  setConfirm(false);
                  setError(null);
                }}
              >
                {t("Cancel")}
              </button>
              <button className="btn danger solid" disabled={busy || !confirm || !password}>
                {busy ? t("Deleting…") : t("Delete permanently")}
              </button>
            </Actions>
          </form>
        )}
      </div>
    </section>
  );
}

export function AccountPanel(props: {
  username: string;
  email: string;
  policy: PasswordPolicy;
  devices: Device[];
  required: boolean;
  codesLeft: number;
  isOwner: boolean;
  sessions: SessionInfo[];
}) {
  return (
    <div className="account-grid">
      <TwoFactor devices={props.devices} required={props.required} codesLeft={props.codesLeft} />
      <ProfileForm username={props.username} email={props.email} />
      <PasswordForm policy={props.policy} />
      <PrivacyPanel isOwner={props.isOwner} />
      <Sessions sessions={props.sessions} />
    </div>
  );
}
