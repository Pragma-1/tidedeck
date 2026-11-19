// Collects every user-facing English string in src/ (used by the i18n completeness test).
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../src");
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(f) && !f.startsWith("i18n-de")) files.push(p);
  }
})(ROOT);

const STR = `"((?:[^"\\\\]|\\\\.)*)"|\`((?:[^\`\\\\]|\\\\.)*)\``;
const RULES = [
  new RegExp(`\\bt\\(\\s*(?:${STR})`, "g"), // t("...")
  new RegExp(`\\bmsg\\(\\s*(?:${STR})`, "g"), // msg("...")
  new RegExp(`\\?\\?\\s*(?:${STR})\\s*\\)`, "g"), // t(x ?? "...")
  new RegExp(`new HttpError\\(\\s*\\d+\\s*,\\s*(?:${STR})`, "g"), // server errors
  new RegExp(`\\bstr\\([^,]+,\\s*(?:${STR})`, "g"), // field names
  new RegExp(`\\berror:\\s*(?:${STR})`, "g"), // { error: "..." }
  new RegExp(`return\\s+(?:${STR});`, "g"), // password rule messages
];

/** Returns [{ text, sample, file }]: `sample` has ${...} replaced so pattern matching can be tested. */
export function scan() {
  const out = new Map();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const isPw = f.endsWith("password.ts") || f.endsWith("validate.ts");
    RULES.forEach((re, i) => {
      if (i === 6 && !isPw) return;
      for (const m of src.matchAll(re)) {
        const raw = m[1] ?? m[2];
        if (raw === undefined || !/[A-Za-z]{2}/.test(raw)) continue;
        const text = raw.replace(/\\(["`\\])/g, "$1").replace(/\\n/g, "\n");
        const sample = text.replace(/\$\{[^}]*\}/g, "12");
        out.set(text, { text, sample, file: path.relative(ROOT, f) });
      }
    });
  }
  return [...out.values()];
}

if (process.argv[1] && process.argv[1].endsWith("i18n-scan.mjs"))
  for (const s of scan()) console.log(JSON.stringify(s.text));
