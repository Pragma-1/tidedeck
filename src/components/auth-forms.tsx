"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { call, safeNext } from "@/lib/client-api";
import { Field, Notice, PasswordInput } from "./ui";
import { PasswordRules } from "./password-rules";
import type { PasswordPolicy } from "@/lib/password-policy";
import { useT } from "./i18n";

function useSubmit() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | undefined>();
  return {
    busy,
    error,
    field,
    setError,
    run: async <T,>(
      fn: () => Promise<{ ok: boolean; data: T & { error?: string; field?: string } }>,
      onOk: (d: T) => void,
    ) => {
      setBusy(true);
      setError(null);
      setField(undefined);
      const r = await fn();
      setBusy(false);
      if (r.ok) onOk(r.data);
      else {
        setError(t(r.data.error ?? "Something went wrong."));
        setField(r.data.field);
      }
    },
  };
}

export function LoginForm({ next, canRegister, canReset }: { next?: string; canRegister: boolean; canReset: boolean }) {
  const t = useT();
  const router = useRouter();
  const s = useSubmit();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfa, setMfa] = useState(false);

  const done = () => {
    router.push(safeNext(next));
    router.refresh();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!mfa)
      void s.run(
        () => call<{ mfa: boolean }>("/api/auth/login", "POST", { username, password }),
        (d) => {
          if (d.mfa) {
            setMfa(true);
            setPassword("");
          } else done();
        },
      );
    else
      void s.run(
        () => call<{ restart?: boolean }>("/api/auth/2fa", "POST", { code }),
        () => done(),
      );
  };
  const restart = () => {
    setMfa(false);
    setCode("");
    s.setError(null);
  };

  return (
    <form className="auth card" onSubmit={submit}>
      {mfa && (
        <button type="button" className="back-link" onClick={restart}>
          <ArrowLeft size={16} aria-hidden />
          {t("Back to sign in")}
        </button>
      )}
      <h1>{mfa ? t("Enter your code") : t("Sign in")}</h1>
      <p className="lead">
        {mfa
          ? t("Open your authenticator app and type the 6-digit code. Lost your phone? Use one of your recovery codes.")
          : t("Sign in to add and edit pages. Reading never needs an account.")}
      </p>
      {s.error && <Notice kind="error">{s.error}</Notice>}
      {!mfa ? (
        <>
          <Field id="username" label={t("Username or e-mail")}>
            <input
              className="input"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              maxLength={254}
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
            />
          </Field>
          <div className="field">
            <div className="label-row">
              <label htmlFor="password">{t("Password")}</label>
              {canReset && (
                <Link href="/forgot" className="small-link">
                  {t("Forgot your password?")}
                </Link>
              )}
            </div>
            <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
          </div>
        </>
      ) : (
        <Field id="code" label={t("Authentication or recovery code")}>
          <input
            className="input code-input"
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            inputMode="text"
            required
            maxLength={20}
            autoFocus
            spellCheck={false}
          />
        </Field>
      )}
      <button className="btn block" disabled={s.busy}>
        {s.busy ? t("Checking…") : mfa ? t("Verify") : t("Sign in")}
      </button>
      {!mfa && canRegister && (
        <p className="auth-foot">
          {t("New here?")} <Link href="/register">{t("Create an account")}</Link>
        </p>
      )}
    </form>
  );
}

export function RegisterForm({
  policy,
  termsEnabled = true,
  privacyHref = "/privacy",
}: {
  policy: PasswordPolicy;
  termsEnabled?: boolean;
  /** null: no privacy notice to link to */
  privacyHref?: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const s = useSubmit();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form
      className="auth card"
      onSubmit={(e) => {
        e.preventDefault();
        void s.run(
          () => call("/api/auth/register", "POST", { username, email, password }),
          () => {
            router.push("/");
            router.refresh();
          },
        );
      }}
    >
      <h1>{t("Create an account")}</h1>
      <p className="lead">{t("With an account you can add and edit pages.")}</p>
      {s.error && <Notice kind="error">{s.error}</Notice>}
      <Field id="username" label={t("Username")} hint={t("3–32 characters: letters, digits, dot, dash, underscore.")}>
        <input
          className="input"
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
          minLength={3}
          maxLength={32}
          pattern="[A-Za-z0-9][A-Za-z0-9_.\-]{2,31}"
          autoCapitalize="none"
          spellCheck={false}
        />
      </Field>
      <Field id="email" label={t("E-mail")} hint={t("Used only to reset your password.")}>
        <input
          className="input"
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          maxLength={254}
        />
      </Field>
      <Field
        id="password"
        label={t("Password")}
        hint={t("A passphrase of a few unrelated words works well.")}
        extra={<PasswordRules id="password-rules" value={password} policy={policy} />}
      >
        <PasswordInput
          id="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          describedBy="password-rules password-hint"
        />
      </Field>
      <p className="hint legal-note">
        {termsEnabled && (
          <>
            {t("By creating an account you accept the")}{" "}
            <Link href="/terms" target="_blank">
              {t("terms of use")}
            </Link>
            .{" "}
          </>
        )}
        {privacyHref && (
          <>
            {t("How we handle your data:")}{" "}
            <a href={privacyHref} target="_blank" rel="noopener noreferrer">
              {t("privacy notice")}
            </a>
            .
          </>
        )}
      </p>
      <button className="btn block" disabled={s.busy}>
        {s.busy ? t("Creating…") : t("Create account")}
      </button>
      <p className="auth-foot">
        {t("Already registered?")} <Link href="/login">{t("Sign in")}</Link>
      </p>
    </form>
  );
}

export function ForgotForm() {
  const t = useT();
  const s = useSubmit();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="auth card"
      onSubmit={(e) => {
        e.preventDefault();
        void s.run(
          () => call<{ message: string }>("/api/auth/forgot", "POST", { email }),
          (d) => setMsg(d.message),
        );
      }}
    >
      <Link href="/login" className="back-link">
        <ArrowLeft size={16} aria-hidden />
        {t("Back to sign in")}
      </Link>
      <h1>{t("Reset your password")}</h1>
      <p className="lead">{t("Enter the e-mail address of your account and we’ll send a link.")}</p>
      {s.error && <Notice kind="error">{s.error}</Notice>}
      {msg && <Notice>{msg}</Notice>}
      <Field id="email" label={t("E-mail")}>
        <input
          className="input"
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          maxLength={254}
          autoFocus
        />
      </Field>
      <button className="btn block" disabled={s.busy}>
        {s.busy ? t("Sending…") : t("Send reset link")}
      </button>
    </form>
  );
}

export function ResetForm({ policy }: { policy: PasswordPolicy }) {
  const t = useT();
  const router = useRouter();
  const s = useSubmit();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    // The token lives in the URL fragment: it is never sent to the server or written to logs by the browser.
    const m = /(?:^|[#&])token=([\w-]+)/.exec(window.location.hash);
    setToken(m ? m[1] : "");
    if (m) history.replaceState(null, "", window.location.pathname);
  }, []);
  if (token === null) return null;
  if (done)
    return (
      <div className="auth card">
        <h1>{t("Password changed")}</h1>
        <Notice>{t("You were signed out everywhere. Sign in with your new password.")}</Notice>
        <button className="btn block" onClick={() => router.push("/login")}>
          {t("Go to sign in")}
        </button>
      </div>
    );
  if (!token)
    return (
      <div className="auth card">
        <h1>{t("Link not valid")}</h1>
        <Notice kind="error">{t("This reset link is missing or incomplete. Request a new one.")}</Notice>
        <Link className="btn block" href="/forgot">
          {t("Request a new link")}
        </Link>
      </div>
    );
  return (
    <form
      className="auth card"
      onSubmit={(e) => {
        e.preventDefault();
        void s.run(
          () => call("/api/auth/reset", "POST", { token, password }),
          () => setDone(true),
        );
      }}
    >
      <h1>{t("Choose a new password")}</h1>
      <p className="lead">{t("If you use two-factor authentication, you’ll still need your code to sign in.")}</p>
      {s.error && <Notice kind="error">{s.error}</Notice>}
      <Field
        id="password"
        label={t("New password")}
        extra={<PasswordRules id="password-rules" value={password} policy={policy} />}
      >
        <PasswordInput
          id="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          describedBy="password-rules"
        />
      </Field>
      <button className="btn block" disabled={s.busy}>
        {s.busy ? t("Saving…") : t("Save password")}
      </button>
    </form>
  );
}

export function SetupForm({ policy }: { policy: PasswordPolicy }) {
  const t = useT();
  const router = useRouter();
  const s = useSubmit();
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("admin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form
      className="auth card wide-card"
      onSubmit={(e) => {
        e.preventDefault();
        void s.run(
          () => call("/api/setup", "POST", { token, username, email, password }),
          () => {
            router.push("/");
            router.refresh();
          },
        );
      }}
    >
      <h1>{t("Set up your wiki")}</h1>
      <p className="lead">
        {t(
          "Create the first administrator. The one-time setup token is in the container log (or the value of WIKI_SETUP_TOKEN if you set one in your .env file).",
        )}
      </p>
      {s.error && <Notice kind="error">{s.error}</Notice>}
      <Field id="token" label={t("Setup token")}>
        <input
          className="input"
          id="token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
      </Field>
      <div className="cols-2">
        <Field id="username" label={t("Username")}>
          <input
            className="input"
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            maxLength={32}
          />
        </Field>
        <Field id="email" label={t("E-mail")}>
          <input
            className="input"
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            maxLength={254}
          />
        </Field>
      </div>
      <Field
        id="password"
        label={t("Password")}
        extra={
          <PasswordRules
            id="password-rules"
            value={password}
            policy={{ ...policy, minLength: Math.max(12, policy.minLength) }}
          />
        }
      >
        <PasswordInput
          id="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          describedBy="password-rules"
        />
      </Field>
      <button className="btn block" disabled={s.busy}>
        {s.busy ? t("Creating…") : t("Create administrator")}
      </button>
    </form>
  );
}
