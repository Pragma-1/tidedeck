"use client";
import { useMemo, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, Eraser, Film, Trash2, X } from "lucide-react";
import { call } from "@/lib/client-api";
import { useToast } from "./ui";
import { useConfirm } from "./confirm";
import { useDate, useT } from "./i18n";

type File = {
  id: number;
  name: string;
  mime: string;
  kind: "image" | "video";
  size: number;
  original_name: string | null;
  username: string | null;
  created_at: number;
  /** pages showing it now */
  used_in: number;
  /** deleted pages in the trash that show it */
  in_trash: number;
  /** only older versions show it */
  in_history: boolean;
};
const size = (b: number) =>
  b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
/** Nothing current shows it: no page, no page in the trash. */
const unusedFile = (f: File) => f.used_in === 0 && f.in_trash === 0;

export function MediaPanel({ files, used, quota }: { files: File[]; used: number; quota: number }) {
  const t = useT();
  const date = useDate();
  const router = useRouter();
  const toast = useToast();
  const setNote = toast.show;
  const [filter, setFilter] = useState<"all" | "unused">("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [dialog, confirm] = useConfirm();
  const last = useRef<number | null>(null);

  const shown = useMemo(() => files.filter((f) => filter === "all" || unusedFile(f)), [files, filter]);
  const unused = useMemo(() => files.filter(unusedFile), [files]);
  const unusedBytes = unused.reduce((a, f) => a + f.size, 0);
  const chosen = files.filter((f) => selected.has(f.id));
  const allOn = shown.length > 0 && shown.every((f) => selected.has(f.id));
  const someOn = shown.some((f) => selected.has(f.id));

  const toggle = (f: File, index: number, e: MouseEvent<HTMLInputElement>) => {
    const on = !selected.has(f.id);
    const next = new Set(selected);
    const range =
      e.shiftKey && last.current !== null
        ? shown.slice(Math.min(last.current, index), Math.max(last.current, index) + 1)
        : [f];
    for (const x of range) {
      if (on) next.add(x.id);
      else next.delete(x.id);
    }
    last.current = index;
    setSelected(next);
  };

  /** What happens to pages that still show a file, spelled out before anything is deleted. */
  const consequences = (list: File[]) => {
    const live = list.filter((f) => f.used_in > 0).length;
    const bin = list.filter((f) => f.used_in === 0 && f.in_trash > 0).length;
    const hist = list.filter((f) => unusedFile(f) && f.in_history).length;
    return (
      <>
        {live > 0 && (
          <p>{t("{n} of them are still shown on pages; there they will appear as missing.", { n: live })}</p>
        )}
        {bin > 0 && (
          <p>{t("{n} are shown on deleted pages in the trash; restored, those pages would miss them.", { n: bin })}</p>
        )}
        {hist > 0 && (
          <p>{t("{n} appear only in older versions of pages; those versions will miss them.", { n: hist })}</p>
        )}
        <p>
          {t(
            "The files are deleted for good: from the disk and from the database. Only backups made before keep a copy, until they are rotated out.",
          )}
        </p>
      </>
    );
  };

  const done = (text: string) => {
    setSelected(new Set());
    last.current = null;
    setNote({ ok: true, text });
    router.refresh();
  };

  const deleteSelected = async () => {
    if (!chosen.length) return;
    const bytes = chosen.reduce((a, f) => a + f.size, 0);
    const ok = await confirm({
      title: t("Delete {n} files permanently?", { n: chosen.length }),
      confirmLabel: t("Delete"),
      danger: true,
      body: (
        <>
          <ul className="plain-list pm-confirm-list">
            {chosen.slice(0, 8).map((f) => (
              <li key={f.id}>{f.original_name ?? f.name}</li>
            ))}
            {chosen.length > 8 && <li className="hint">{t("… and {n} more", { n: chosen.length - 8 })}</li>}
          </ul>
          <p className="hint">{t("Frees {size}.", { size: size(bytes) })}</p>
          {consequences(chosen)}
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    const r = await call<{ deleted: number; bytes: number }>("/api/media", "DELETE", { ids: chosen.map((f) => f.id) });
    setBusy(false);
    if (r.ok) done(t("{n} files deleted, {size} freed.", { n: r.data.deleted, size: size(r.data.bytes) }));
    else setNote({ ok: false, text: t(r.data.error ?? "Something went wrong.") });
  };

  const deleteUnused = async () => {
    const ok = await confirm({
      title: t("Delete all unused files?"),
      confirmLabel: t("Delete unused files"),
      danger: true,
      body: (
        <>
          <p>
            {t("{n} files that no page and no page in the trash shows ({size}).", {
              n: unused.length,
              size: size(unusedBytes),
            })}{" "}
            {t("Stray files on the disk without an entry (left behind by a crash) are removed too.")}
          </p>
          {consequences(unused)}
        </>
      ),
    });
    if (!ok) return;
    setBusy(true);
    const r = await call<{ deleted: number; strays: number; bytes: number }>("/api/media/unused", "POST");
    setBusy(false);
    if (r.ok)
      done(t("{n} files deleted, {size} freed.", { n: r.data.deleted + r.data.strays, size: size(r.data.bytes) }));
    else setNote({ ok: false, text: t(r.data.error ?? "Something went wrong.") });
  };

  const del = async (f: File) => {
    const ok = await confirm({
      title: t("Delete this file permanently?"),
      confirmLabel: t("Delete"),
      danger: true,
      body: (
        <>
          <strong>{f.original_name ?? f.name}</strong>
          {consequences([f])}
        </>
      ),
    });
    if (!ok) return;
    const r = await call<{ deleted: number; bytes: number }>("/api/media", "DELETE", { ids: [f.id] });
    if (r.ok) done(t("File deleted."));
    else setNote({ ok: false, text: t(r.data.error ?? "Something went wrong.") });
  };

  const usage = (f: File) =>
    f.used_in ? (
      t("{n} page(s)", { n: f.used_in })
    ) : f.in_trash ? (
      <span className="badge">{t("only in the trash")}</span>
    ) : f.in_history ? (
      <span className="badge warn">{t("only in old versions")}</span>
    ) : (
      <span className="badge warn">{t("unused")}</span>
    );

  return (
    <section>
      <div className="row between section-head">
        <div className="usage" title={`${size(used)} / ${size(quota)}`}>
          <span className="hint">{t("{used} of {quota} used", { used: size(used), quota: size(quota) })}</span>
          <span className="bar">
            <span style={{ width: `${Math.min(100, (used / quota) * 100)}%` }} />
          </span>
        </div>
        <select
          className="input"
          style={{ width: "12rem" }}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as "all" | "unused");
            last.current = null;
          }}
          aria-label={t("Show")}
        >
          <option value="all">{t("All files")}</option>
          <option value="unused">{t("Unused files only")}</option>
        </select>
      </div>
      {toast.node}
      {dialog}
      <p className="hint">
        {t(
          "Editors upload images and videos in the page editor (button, paste or drag & drop). Metadata such as GPS location is removed from images on upload.",
        )}
      </p>
      <div className="pm-bar" role="toolbar" aria-label={t("Selection")}>
        <span className="pm-count" aria-live="polite">
          {chosen.length
            ? t("{n} selected", { n: chosen.length }) + ` · ${size(chosen.reduce((a, f) => a + f.size, 0))}`
            : t("Nothing selected")}
        </span>
        {chosen.length > 0 && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              setSelected(new Set());
              last.current = null;
            }}
          >
            <X size={15} aria-hidden />
            {t("Clear selection")}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn ghost sm"
          disabled={busy || unused.length === 0}
          onClick={() => void deleteUnused()}
          title={t("Deletes every file that no page and no page in the trash shows.")}
        >
          <Eraser size={15} aria-hidden />
          {unused.length
            ? t("Delete unused ({n}, {size})", { n: unused.length, size: size(unusedBytes) })
            : t("No unused files")}
        </button>
        <button
          type="button"
          className="btn danger sm"
          disabled={busy || chosen.length === 0}
          onClick={() => void deleteSelected()}
        >
          <Trash2 size={15} aria-hidden />
          {busy ? t("Deleting…") : t("Delete selected")}
        </button>
      </div>
      <div className="table-wrap">
        <table className="data media-table">
          <thead>
            <tr>
              <th className="pm-check">
                <input
                  type="checkbox"
                  aria-label={t("Select all shown files")}
                  checked={allOn}
                  ref={(el) => {
                    if (el) el.indeterminate = someOn && !allOn;
                  }}
                  disabled={!shown.length || busy}
                  onChange={() => {
                    const next = new Set(selected);
                    for (const f of shown) {
                      if (allOn) next.delete(f.id);
                      else next.add(f.id);
                    }
                    last.current = null;
                    setSelected(next);
                  }}
                />
              </th>
              <th>{t("File")}</th>
              <th>{t("Size")}</th>
              <th>{t("Uploaded")}</th>
              <th>{t("Used on")}</th>
              <th>
                <span className="sr-only">{t("Actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f, i) => (
              <tr key={f.id} className={selected.has(f.id) ? "pm-on" : undefined}>
                <td className="pm-check">
                  <input
                    type="checkbox"
                    checked={selected.has(f.id)}
                    disabled={busy}
                    aria-label={t("Select “{title}”", { title: f.original_name ?? f.name })}
                    onClick={(e) => toggle(f, i, e)}
                    onChange={() => {
                      /* handled in onClick (needs the shift key) */
                    }}
                  />
                </td>
                <td>
                  <div className="file-cell">
                    {f.kind === "image" ? (
                      <img src={`/media/${f.name}`} alt="" loading="lazy" />
                    ) : (
                      <span className="thumb">
                        <Film size={20} aria-hidden />
                      </span>
                    )}
                    <span>
                      <strong>{f.original_name ?? f.name}</strong>
                      <br />
                      <span className="hint mono">{f.mime}</span>
                    </span>
                  </div>
                </td>
                <td className="nowrap">{size(f.size)}</td>
                <td className="nowrap">
                  {date(f.created_at)}
                  <br />
                  <span className="hint">{f.username ?? t("deleted account")}</span>
                </td>
                <td>{usage(f)}</td>
                <td className="right nowrap">
                  <button
                    type="button"
                    className="btn ghost sm"
                    title={t("Copy Markdown")}
                    onClick={() =>
                      void navigator.clipboard?.writeText(
                        f.kind === "video"
                          ? `@[${f.original_name ?? ""}](/media/${f.name})`
                          : `![${f.original_name ?? ""}](/media/${f.name})`,
                      )
                    }
                  >
                    <Copy size={15} aria-hidden />
                  </button>{" "}
                  <a
                    className="btn ghost sm"
                    href={`/media/${f.name}`}
                    target="_blank"
                    rel="noreferrer"
                    title={t("Open")}
                  >
                    <ExternalLink size={15} aria-hidden />
                  </a>{" "}
                  <button
                    type="button"
                    className="btn danger sm"
                    disabled={busy}
                    onClick={() => void del(f)}
                    title={t("Delete")}
                  >
                    <Trash2 size={15} aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="hint" style={{ textAlign: "center", padding: "2rem" }}>
                  {filter === "unused" && files.length ? t("No unused files.") : t("No files yet.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="hint">{t("Tip: Shift-click selects a range.")}</p>
    </section>
  );
}
