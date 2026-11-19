"use client";
import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, X } from "lucide-react";
import { useT } from "./i18n";

export function Notice({ kind = "info", children }: { kind?: "info" | "error"; children: ReactNode }) {
  return (
    <div className={`notice ${kind === "error" ? "error" : ""}`} role={kind === "error" ? "alert" : "status"}>
      {kind === "error" ? <AlertTriangle size={18} aria-hidden /> : <CheckCircle2 size={18} aria-hidden />}
      <div>{children}</div>
    </div>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
  extra,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {extra}
      {hint && (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="error-text" id={`${id}-err`}>
          {error}
        </span>
      )}
    </div>
  );
}

export function PasswordInput(props: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password" | "off";
  required?: boolean;
  describedBy?: string;
}) {
  const t = useT();
  const [show, setShow] = useState(false);
  return (
    <div className="pw">
      <input
        className="input"
        id={props.id}
        type={show ? "text" : "password"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        required={props.required ?? true}
        maxLength={256}
        aria-describedby={props.describedBy}
        spellCheck={false}
        autoCapitalize="none"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t("Hide password") : t("Show password")}
      >
        {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
      </button>
    </div>
  );
}

/**
 * Feedback that floats at the bottom of the screen instead of being inserted into the page,
 * so saving never shifts the layout. Successes fade after 2.5 s, errors stay until dismissed or 8 s.
 */
export function useToast() {
  const t = useT();
  const [msg, show] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const h = setTimeout(() => show(null), msg.ok ? 2500 : 8000);
    return () => clearTimeout(h);
  }, [msg]);
  const node = msg ? (
    <div className={`toast${msg.ok ? "" : " toast-error"}`} role={msg.ok ? "status" : "alert"}>
      {msg.ok ? <CheckCircle2 size={16} aria-hidden /> : <AlertTriangle size={16} aria-hidden />}
      <span>{msg.text}</span>
      <button type="button" onClick={() => show(null)} aria-label={t("Dismiss")}>
        <X size={14} aria-hidden />
      </button>
    </div>
  ) : null;
  return { show, node };
}

/** Secondary actions on the left, the primary (forward) action on the right — the common Western convention. */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="actions">{children}</div>;
}
