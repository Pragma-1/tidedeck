"use client";
import { Check, Circle } from "lucide-react";
import { policyChecks, RULE_LABELS, type PasswordPolicy } from "@/lib/password-policy";
import { useT } from "./i18n";

/** Live checklist of the password policy. Informational only — the server decides. */
export function PasswordRules({ id, value, policy }: { id: string; value: string; policy: PasswordPolicy }) {
  const t = useT();
  const checks = policyChecks(value, policy);
  return (
    <ul className="pw-rules" id={id} aria-label={t("Password requirements")}>
      {checks.map((c) => (
        <li key={c.id} data-ok={c.ok ? "1" : undefined}>
          {c.ok ? <Check size={14} aria-hidden /> : <Circle size={10} aria-hidden />}
          <span>{t(RULE_LABELS[c.id], { n: c.n })}</span>
          <span className="sr-only">{c.ok ? t("met") : t("not met yet")}</span>
        </li>
      ))}
    </ul>
  );
}
