"use client";
import { useState } from "react";
import Link from "next/link";
import { ExternalLink, FileText, RotateCcw } from "lucide-react";
import { call } from "@/lib/client-api";
import { msg } from "@/lib/msg";
import type { Lang } from "@/lib/i18n";
import { Actions, Notice, useToast } from "./ui";
import { useConfirm } from "./confirm";
import { useDate, useLang, useT } from "./i18n";

type Status = { key: "privacy" | "terms" | "imprint"; custom: Record<Lang, number | null> };
const TITLES = { privacy: msg("Privacy notice"), terms: msg("Terms of use"), imprint: msg("Imprint") } as const;
const PATHS = { privacy: "/privacy", terms: "/terms", imprint: "/imprint" } as const;

export function LegalEditor({ pages, missing }: { pages: Status[]; missing: string[] }) {
  const t = useT();
  const date = useDate();
  const lang: Lang = useLang();
  // which pages exist comes from the server (it follows the switches above after a refresh);
  // only what was just saved or reset here is kept locally on top of it
  const [marks, setMarks] = useState<Partial<Record<Status["key"], Partial<Record<Lang, number | null>>>>>({});
  const status = pages.map((p) => (marks[p.key] ? { ...p, custom: { ...p.custom, ...marks[p.key] } } : p));
  const [open, setOpen] = useState<Status["key"] | null>(null);
  const [text, setText] = useState("");
  const toast = useToast();
  const setNote = toast.show;
  const [busy, setBusy] = useState(false);
  const [dialog, confirm] = useConfirm();

  const edit = async (key: Status["key"]) => {
    setBusy(true);
    setNote(null);
    const res = await fetch(`/api/legal/${key}?lang=${lang}`, { credentials: "same-origin" });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) {
      setNote({ ok: false, text: t(d.error ?? "Something went wrong.") });
      return;
    }
    setText(d.content);
    setOpen(key);
  };
  const mark = (key: Status["key"], v: number | null) =>
    setMarks((cur) => ({ ...cur, [key]: { ...cur[key], [lang]: v } }));
  const save = async () => {
    if (!open) return;
    setBusy(true);
    const r = await call(`/api/legal/${open}`, "PUT", { lang, content: text });
    setBusy(false);
    if (r.ok) {
      mark(open, Math.floor(Date.now() / 1000));
      setOpen(null);
      setNote({ ok: true, text: t("Saved.") });
    } else setNote({ ok: false, text: t(r.data.error ?? "Couldn’t save.") });
  };
  const reset = async (key: Status["key"]) => {
    if (
      !(await confirm({
        title: t("Use the template again?"),
        body: t("Discard your own text and use the generated template again?"),
        confirmLabel: t("Use template"),
        danger: true,
      }))
    )
      return;
    const r = await call(`/api/legal/${key}?lang=${lang}`, "DELETE");
    if (r.ok) {
      mark(key, null);
      setOpen(null);
      setNote({ ok: true, text: t("The page uses the template again.") });
    }
  };

  return (
    <section className="panel legal-editor">
      <div className="row between">
        <h2 className="section-title">
          <FileText size={18} aria-hidden /> {t("Legal pages")}
        </h2>
      </div>
      <p className="hint">
        {t(
          "The templates describe exactly what this software stores and are filled with your operator details and settings. They are not legal advice — have them checked for your organisation, and adjust them if you process data in other ways (e.g. backups, a reverse proxy that writes access logs).",
        )}
      </p>
      {missing.length > 0 && (
        <Notice kind="error">
          {missing.includes("operator_address")
            ? t("Fill in name, address and e-mail of the operator — until then the pages show placeholders.")
            : t("Fill in name and e-mail of the operator — until then the privacy notice shows placeholders.")}
        </Notice>
      )}
      {toast.node}
      {dialog}
      <ul className="legal-list">
        {status.map((p) => (
          <li key={p.key}>
            <div>
              <strong>{t(TITLES[p.key])}</strong>{" "}
              {p.custom[lang] ? (
                <span className="badge warn">
                  {t("own text")} · {date(p.custom[lang]!)}
                </span>
              ) : (
                <span className="badge">{t("template")}</span>
              )}
            </div>
            <div className="row">
              <Link className="btn ghost sm" href={PATHS[p.key]} target="_blank">
                <ExternalLink size={15} aria-hidden />
                {t("View")}
              </Link>
              {p.custom[lang] && (
                <button type="button" className="btn ghost sm" onClick={() => void reset(p.key)}>
                  <RotateCcw size={15} aria-hidden />
                  {t("Use template")}
                </button>
              )}
              <button type="button" className="btn sm" disabled={busy} onClick={() => void edit(p.key)}>
                {t("Adjust text")}
              </button>
            </div>
            {open === p.key && (
              <div className="legal-edit">
                <label className="sr-only" htmlFor={`lg-${p.key}`}>
                  {t(TITLES[p.key])}
                </label>
                <textarea
                  id={`lg-${p.key}`}
                  className="input"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  spellCheck
                />
                <p className="hint">
                  {t("Markdown. Once you save, this text is used as-is and no longer updates when settings change.")}
                </p>
                <Actions>
                  <button type="button" className="btn ghost" onClick={() => setOpen(null)}>
                    {t("Cancel")}
                  </button>
                  <button type="button" className="btn" disabled={busy || !text.trim()} onClick={() => void save()}>
                    {t("Save page")}
                  </button>
                </Actions>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
