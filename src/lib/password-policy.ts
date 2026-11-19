/**
 * Password composition rules (admin setting). Pure and dependency-free so the same checks run
 * in the browser (live hints) and on the server (the only place that actually decides).
 */
import { msg } from "./msg";

export type PasswordPolicy = { minLength: number; digits: number; special: number; upper: number; lower: number };

export const policyFromSettings = (s: {
  password_min_length: number;
  password_min_digits: number;
  password_min_special: number;
  password_min_upper: number;
  password_min_lower: number;
}): PasswordPolicy => ({
  minLength: s.password_min_length,
  digits: s.password_min_digits,
  special: s.password_min_special,
  upper: s.password_min_upper,
  lower: s.password_min_lower,
});

export type RuleId = "length" | "digits" | "special" | "upper" | "lower";

/** Counts per character class. Unicode-aware: "Ä" is an upper-case letter, "٣" a digit. */
export function countClasses(pw: string) {
  let length = 0,
    digits = 0,
    special = 0,
    upper = 0,
    lower = 0;
  for (const ch of pw) {
    length++;
    if (/\p{Nd}/u.test(ch)) digits++;
    else if (/\p{Lu}/u.test(ch)) upper++;
    else if (/\p{Ll}/u.test(ch)) lower++;
    else if (!/[\p{L}\p{N}\s]/u.test(ch)) special++; // punctuation, symbols, emoji …
  }
  return { length, digits, special, upper, lower };
}

/** Every active rule with whether it is met; rules set to 0 are not listed. */
export function policyChecks(pw: string, p: PasswordPolicy): { id: RuleId; n: number; ok: boolean }[] {
  const c = countClasses(pw);
  const rules: { id: RuleId; n: number; have: number }[] = [
    { id: "length", n: p.minLength, have: c.length },
    { id: "digits", n: p.digits, have: c.digits },
    { id: "special", n: p.special, have: c.special },
    { id: "upper", n: p.upper, have: c.upper },
    { id: "lower", n: p.lower, have: c.lower },
  ];
  return rules.filter((r) => r.n > 0).map((r) => ({ id: r.id, n: r.n, ok: r.have >= r.n }));
}

/** English messages (translated by the i18n layer, which matches the {n} placeholder). */
export const RULE_MESSAGES: Record<RuleId, string> = {
  length: msg("Use at least {n} characters. A passphrase of several words works well."),
  digits: msg("Use at least {n} digit(s)."),
  special: msg("Use at least {n} special character(s), e.g. ! ? # % or -."),
  upper: msg("Use at least {n} upper-case letter(s)."),
  lower: msg("Use at least {n} lower-case letter(s)."),
};

export const RULE_LABELS: Record<RuleId, string> = {
  length: msg("At least {n} characters"),
  digits: msg("At least {n} digit(s)"),
  special: msg("At least {n} special character(s)"),
  upper: msg("At least {n} upper-case letter(s)"),
  lower: msg("At least {n} lower-case letter(s)"),
};
