"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Mail, Send, Save } from "lucide-react";
import { call } from "@/lib/client-api";
import { Actions, Field, Notice, PasswordInput, useToast } from "./ui";
import { useT } from "./i18n";

export type MailSettings = {
  smtp_host: string;
  smtp_port: number;
  smtp_security: "starttls" | "tls" | "none";
  smtp_user: string;
  smtp_from: string;
  smtp_allow_self_signed: boolean;
  smtp_password_set: boolean;
  mail_source: "settings" | "env" | "none";
};

const PORTS = [587, 465, 25, 2525, 26, 1025];

export function MailPanel({
  initial,
  adminEmail,
  envConfigured,
  siteName,
}: {
  initial: MailSettings;
  adminEmail: string;
  envConfigured: boolean;
  siteName: string;
}) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState(initial);
  const [password, setPassword] = useState("");
  const [clearPw, setClearPw] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty =
    f.smtp_host !== initial.smtp_host ||
    f.smtp_port !== initial.smtp_port ||
    f.smtp_security !== initial.smtp_security ||
    f.smtp_user !== initial.smtp_user ||
    f.smtp_from !== initial.smtp_from ||
    f.smtp_allow_self_signed !== initial.smtp_allow_self_signed ||
    !!password ||
    clearPw;

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy("save");
    setTestResult(null);
    const body: Record<string, unknown> = {
      smtp_host: f.smtp_host.trim(),
      smtp_port: f.smtp_port,
      smtp_security: f.smtp_security,
      smtp_user: f.smtp_user.trim(),
      smtp_from: f.smtp_from.trim(),
      smtp_allow_self_signed: f.smtp_allow_self_signed,
    };
    if (password) body.smtp_password = password;
    else if (clearPw) body.smtp_password = null;
    const r = await call<MailSettings>("/api/settings", "PUT", body);
    setBusy(null);
    if (!r.ok) {
      toast.show({ ok: false, text: t(r.data.error ?? "Couldn’t save.") });
      return false;
    }
    setF({ ...f, ...pick(r.data) });
    setPassword("");
    setClearPw(false);
    toast.show({ ok: true, text: t("Saved.") });
    router.refresh();
    return true;
  };
  const test = async () => {
    if (dirty && !(await save())) return;
    setBusy("test");
    setTestResult(null);
    const r = await call<{ to: string }>("/api/settings/mail-test", "POST");
    setBusy(null);
    setTestResult(
      r.ok
        ? {
            ok: true,
            text: t("Test e-mail sent to {email}. Check the inbox (and the spam folder).", { email: r.data.to }),
          }
        : { ok: false, text: t(r.data.error ?? "Something went wrong.") },
    );
  };

  return (
    <form className="panel mail-panel" onSubmit={save}>
      {toast.node}
      <h2 className="section-title">
        <Mail size={18} aria-hidden /> {t("E-mail (SMTP)")}
      </h2>
      <p className="hint section-note">
        {t("Used for password reset links, notices about account changes and test e-mails.")}{" "}
        {f.mail_source === "settings"
          ? t("Currently active: the settings on this page.")
          : f.mail_source === "env"
            ? t("Currently active: the SMTP_* variables from the .env file. Fill in a server here to override them.")
            : t("No mail server is configured yet.")}
      </p>
      {envConfigured && f.smtp_host === "" && (
        <Notice>{t("Leave the server empty to keep using the .env configuration.")}</Notice>
      )}
      <div className="cols-3">
        <Field id="smtp-host" label={t("Server")} hint={t("Host name, e.g. smtp.example.org")}>
          <input
            className="input"
            id="smtp-host"
            value={f.smtp_host}
            onChange={(e) => setF({ ...f, smtp_host: e.target.value })}
            maxLength={253}
            autoComplete="off"
            spellCheck={false}
            placeholder="smtp.example.org"
          />
        </Field>
        <Field id="smtp-port" label={t("Port")}>
          <select
            className="input"
            id="smtp-port"
            value={f.smtp_port}
            onChange={(e) => setF({ ...f, smtp_port: Number(e.target.value) })}
          >
            {PORTS.map((p) => (
              <option key={p} value={p}>
                {p}
                {p === 587 ? " (STARTTLS)" : p === 465 ? " (TLS)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field id="smtp-sec" label={t("Encryption")}>
          <select
            className="input"
            id="smtp-sec"
            value={f.smtp_security}
            onChange={(e) => setF({ ...f, smtp_security: e.target.value as MailSettings["smtp_security"] })}
          >
            <option value="starttls">{t("STARTTLS (required)")}</option>
            <option value="tls">{t("TLS from the start")}</option>
            <option value="none">{t("None (only inside a trusted network)")}</option>
          </select>
        </Field>
      </div>
      <div className="cols-3">
        <Field id="smtp-user" label={t("User name (optional)")}>
          <input
            className="input"
            id="smtp-user"
            value={f.smtp_user}
            onChange={(e) => setF({ ...f, smtp_user: e.target.value })}
            maxLength={254}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field
          id="smtp-pw"
          label={t("Password")}
          hint={
            f.smtp_password_set && !clearPw
              ? t("A password is stored (encrypted). Leave empty to keep it.")
              : t("Stored encrypted, never shown again.")
          }
        >
          <PasswordInput
            id="smtp-pw"
            value={password}
            onChange={(v) => {
              setPassword(v);
              if (v) setClearPw(false);
            }}
            autoComplete="new-password"
            required={false}
          />
        </Field>
        <Field
          id="smtp-from"
          label={t("Sender address")}
          hint={t("Shown as “{site}” with this address.", { site: siteName })}
        >
          <input
            className="input"
            id="smtp-from"
            type="email"
            value={f.smtp_from}
            onChange={(e) => setF({ ...f, smtp_from: e.target.value })}
            maxLength={254}
            autoComplete="off"
            placeholder="wiki@example.org"
          />
        </Field>
      </div>
      <div className="row wrap">
        <label className="check">
          <input
            type="checkbox"
            checked={f.smtp_allow_self_signed}
            onChange={(e) => setF({ ...f, smtp_allow_self_signed: e.target.checked })}
          />{" "}
          {t("Accept self-signed certificates (only for your own mail server)")}
        </label>
        {f.smtp_password_set && !password && (
          <label className="check">
            <input type="checkbox" checked={clearPw} onChange={(e) => setClearPw(e.target.checked)} />{" "}
            {t("Remove the stored password")}
          </label>
        )}
      </div>
      {testResult && <Notice kind={testResult.ok ? "info" : "error"}>{testResult.text}</Notice>}
      <Actions>
        <button
          type="button"
          className="btn ghost"
          disabled={busy !== null || (f.mail_source === "none" && !f.smtp_host.trim())}
          onClick={() => void test()}
          title={t("Sends to {email}", { email: adminEmail })}
        >
          <Send size={16} aria-hidden />
          {busy === "test" ? t("Sending…") : dirty ? t("Save and send test e-mail") : t("Send test e-mail")}
        </button>
        <button className="btn" disabled={busy !== null || !dirty}>
          <Save size={16} aria-hidden />
          {busy === "save" ? t("Saving…") : t("Save")}
        </button>
      </Actions>
      <p className="hint">{t("The test e-mail always goes to your own address ({email}).", { email: adminEmail })}</p>
    </form>
  );
}

function pick(d: Partial<MailSettings>): Partial<MailSettings> {
  const {
    smtp_host,
    smtp_port,
    smtp_security,
    smtp_user,
    smtp_from,
    smtp_allow_self_signed,
    smtp_password_set,
    mail_source,
  } = d;
  return {
    smtp_host,
    smtp_port,
    smtp_security,
    smtp_user,
    smtp_from,
    smtp_allow_self_signed,
    smtp_password_set,
    mail_source,
  };
}
