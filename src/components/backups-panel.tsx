"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArchiveRestore,
  Cloud,
  DatabaseBackup,
  Download,
  FolderOpen,
  HardDrive,
  RotateCcw,
  SearchCheck,
  Trash2,
  Upload,
  UserRound,
  FileText,
  X,
} from "lucide-react";
import { call } from "@/lib/client-api";
import { useConfirm } from "./confirm";
import { useToast } from "./ui";
import { useT } from "./i18n";

export type BackupView = {
  id: string;
  when: string;
  original?: string;
  reason: "auto" | "manual" | "pre-restore" | "pre-import" | "upload";
  size: number;
  media_count: number;
  counts: { pages: number; page_revisions: number; users: number; trash: number };
};
type Target = {
  kind: "local" | "s3";
  where: string;
  localDir: string;
  localDefault: string;
  localCustom: string;
  localRoots: string[];
  sameVolume: boolean;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    prefix: string;
    access_key: string;
    path_style: boolean;
    secret_set: boolean;
  };
};
type Inside = {
  id: string;
  pages: { id: number; slug: string; title: string; rev: number; exists: boolean }[];
  users: { id: number; username: string; email: string; role: string; disabled: number; exists: boolean }[];
};

const size = (b: number) =>
  b >= 1073741824
    ? `${(b / 1073741824).toFixed(1)} GB`
    : b >= 1048576
      ? `${(b / 1048576).toFixed(1)} MB`
      : `${Math.max(1, Math.round(b / 1024))} KB`;

/** A native modal <dialog> that opens while `open` is true. */
function Modal({
  open,
  onClose,
  labelledBy,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`confirm-dlg${wide ? " wide-dlg" : ""}`}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && children}
    </dialog>
  );
}

export function BackupsPanel({
  items,
  unreadable,
  listError,
  isOwner,
  enabled,
  target,
}: {
  items: BackupView[];
  unreadable: number;
  /** null: the storage was read; "" or a message: it couldn't be */
  listError: string | null;
  isOwner: boolean;
  enabled: boolean;
  target: Target;
}) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [dialog, confirm] = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [restoring, setRestoring] = useState<BackupView | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [inside, setInside] = useState<(Inside & { when: string }) | null>(null);
  const [tab, setTab] = useState<"pages" | "users">("pages");
  const [filter, setFilter] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const REASON: Record<BackupView["reason"], string> = {
    auto: t("automatic"),
    manual: t("manual"),
    "pre-restore": t("before a restore"),
    "pre-import": t("before an import"),
    upload: t("uploaded"),
  };
  const ok = (text: string) => toast.show({ ok: true, text });
  const bad = (e?: string) => toast.show({ ok: false, text: t(e ?? "Something went wrong.") });

  /* ---------------------------------------------------------- actions */

  const now = async () => {
    setBusy("create");
    const r = await call<{ id: string }>("/api/backups", "POST");
    setBusy(null);
    if (r.ok) {
      ok(t("Backup created."));
      router.refresh();
    } else bad(r.data.error);
  };

  const verify = async (b: BackupView) => {
    setBusy(`verify:${b.id}`);
    const r = await call<{ ok: boolean; badFiles: number }>(`/api/backups/${b.id}/verify`, "POST");
    setBusy(null);
    if (!r.ok) return bad(r.data.error);
    if (r.data.ok) ok(t("Backup checked: every entry and every file is complete and unchanged."));
    else bad(t("The backup is incomplete: {n} files are missing or damaged.", { n: r.data.badFiles }));
  };

  const remove = async (b: BackupView) => {
    if (
      !(await confirm({
        title: t("Delete backup?"),
        body: t("The backup from {date} is deleted for good.", { date: b.when }),
        confirmLabel: t("Delete backup"),
        danger: true,
      }))
    )
      return;
    const r = await call(`/api/backups/${b.id}`, "DELETE");
    if (r.ok) {
      ok(t("Deleted."));
      router.refresh();
    } else bad(r.data.error);
  };

  const upload = async (f: File) => {
    setBusy("upload");
    try {
      const res = await fetch("/api/backups/upload", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/zip" },
        body: f,
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        ok(t("Backup uploaded and checked. Restore it from the list when you’re ready."));
        router.refresh();
      } else bad(d.error);
    } catch {
      bad("Can’t reach the server. Check your connection.");
    } finally {
      setBusy(null);
      if (file.current) file.current.value = "";
    }
  };

  const restoreAll = async () => {
    if (!restoring) return;
    setBusy("restore");
    setPwError(null);
    const r = await call<{ safety: string; missingFiles: number }>(`/api/backups/${restoring.id}/restore`, "POST", {
      password,
    });
    setBusy(null);
    if (!r.ok) {
      setPwError(t(r.data.error ?? "Couldn’t restore."));
      return;
    }
    // every session was ended by the restore, ours too
    window.location.assign(`/login?restored=1${r.data.missingFiles ? `&missing=${r.data.missingFiles}` : ""}`);
  };

  const browse = async (b: BackupView) => {
    setBusy(`browse:${b.id}`);
    const r = await call<Inside>(`/api/backups/${b.id}`, "GET");
    setBusy(null);
    if (!r.ok) return bad(r.data.error);
    setFilter("");
    setTab("pages");
    setInside({ ...r.data, when: b.when });
  };

  const restorePage = async (p: Inside["pages"][number]) => {
    if (!inside) return;
    if (
      !(await confirm({
        title: t("Restore “{title}”?", { title: p.title }),
        body: p.exists
          ? t(
              "The page still exists. Its title and text from the backup become a new version on top — the current version stays in the history.",
            )
          : t("The page no longer exists. It is recreated with its whole history from the backup."),
        confirmLabel: t("Restore page"),
      }))
    )
      return;
    setBusy(`page:${p.id}`);
    const r = await call<{ slug: string; mode: string; files: number }>(
      `/api/backups/${inside.id}/pages/${p.id}`,
      "POST",
    );
    setBusy(null);
    if (!r.ok) return bad(r.data.error);
    ok(r.data.mode === "version" ? t("Restored as a new version.") : t("Page restored."));
    setInside({ ...inside, pages: inside.pages.map((x) => (x.id === p.id ? { ...x, exists: true } : x)) });
    router.refresh();
  };

  const restoreUser = async (u: Inside["users"][number]) => {
    if (!inside) return;
    if (
      !(await confirm({
        title: t("Restore the account “{name}”?", { name: u.username }),
        body: t(
          "The account comes back with its role, password and authenticator devices from the backup, and is linked to its pages again. The person signs in with the password they had then.",
        ),
        confirmLabel: t("Restore account"),
      }))
    )
      return;
    setBusy(`user:${u.id}`);
    const r = await call<{ username: string }>(`/api/backups/${inside.id}/users/${u.id}`, "POST");
    setBusy(null);
    if (!r.ok) return bad(r.data.error);
    ok(t("Account restored."));
    setInside({ ...inside, users: inside.users.map((x) => (x.id === u.id ? { ...x, exists: true } : x)) });
    router.refresh();
  };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!inside) return { pages: [], users: [] };
    return {
      pages: inside.pages.filter((p) => !q || p.title.toLowerCase().includes(q) || p.slug.includes(q)).slice(0, 300),
      users: inside.users.filter(
        (u) => !q || u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
      ),
    };
  }, [inside, filter]);

  /* ------------------------------------------------------------- view */

  return (
    <div className="settings-grid">
      {dialog}
      {toast.node}
      <StoragePanel target={target} isOwner={isOwner} onSaved={() => router.refresh()} toast={toast.show} />

      <section className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="row between">
          <h2 className="section-title" style={{ margin: 0 }}>
            <DatabaseBackup size={18} aria-hidden /> {t("Backups")}
          </h2>
          <div className="row">
            {isOwner && (
              <>
                <input
                  ref={file}
                  type="file"
                  accept=".zip,application/zip"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                  }}
                />
                <button type="button" className="btn ghost sm" disabled={!!busy} onClick={() => file.current?.click()}>
                  <Upload size={15} aria-hidden />
                  {busy === "upload" ? t("Checking…") : t("Upload backup")}
                </button>
              </>
            )}
            <button
              type="button"
              className="btn sm"
              disabled={!!busy || !enabled}
              title={enabled ? undefined : t("Backups are switched off.")}
              onClick={() => void now()}
            >
              <DatabaseBackup size={15} aria-hidden />
              {busy === "create" ? t("Backing up…") : t("Back up now")}
            </button>
          </div>
        </div>
        {!enabled && (
          <div className="notice">
            <div>
              {t(
                "Backups are switched off: no new backups are made, neither automatically nor by hand. The backups below stay and can still be opened and restored.",
              )}
            </div>
          </div>
        )}
        {listError !== null && (
          <div className="notice error" role="alert">
            <AlertTriangle size={18} aria-hidden />
            <div>
              {t("The backup storage can’t be read right now.")} {listError && t(listError)}
            </div>
          </div>
        )}
        {unreadable > 0 && (
          <div className="notice error" role="alert">
            <AlertTriangle size={18} aria-hidden />
            <div>
              {t(
                "{n} backups in the storage can’t be read with this wiki’s master key (or are damaged). They are left untouched.",
                { n: unreadable },
              )}
            </div>
          </div>
        )}
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t("Created")}</th>
                <th>{t("Type")}</th>
                <th>{t("Content")}</th>
                <th className="right">{t("Size")}</th>
                <th>
                  <span className="sr-only">{t("Actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id}>
                  <td className="nowrap">
                    {b.when}
                    {b.original && <div className="meta">{t("data from {date}", { date: b.original })}</div>}
                  </td>
                  <td>
                    <span className="badge">{REASON[b.reason]}</span>
                  </td>
                  <td>
                    {t("Pages {p} · versions {r} · accounts {u} · files {m}", {
                      p: b.counts.pages,
                      r: b.counts.page_revisions,
                      u: b.counts.users,
                      m: b.media_count,
                    })}
                    {b.counts.trash > 0 && ` · ${t("trash {n}", { n: b.counts.trash })}`}
                  </td>
                  <td className="right nowrap mono">{size(b.size)}</td>
                  <td className="right nowrap">
                    <div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      <button
                        type="button"
                        className="btn ghost sm"
                        disabled={!!busy}
                        onClick={() => void browse(b)}
                        title={t("Restore single pages or accounts")}
                      >
                        <FolderOpen size={15} aria-hidden />
                        {t("Open")}
                      </button>
                      <button
                        type="button"
                        className="icon-btn plain"
                        disabled={!!busy}
                        title={t("Check backup")}
                        aria-label={t("Check backup from {date}", { date: b.when })}
                        onClick={() => void verify(b)}
                      >
                        <SearchCheck size={15} aria-hidden />
                      </button>
                      {isOwner && (
                        <>
                          <a
                            className="icon-btn plain"
                            href={`/api/backups/${b.id}/download`}
                            title={t("Download")}
                            aria-label={t("Download backup from {date}", { date: b.when })}
                          >
                            <Download size={15} aria-hidden />
                          </a>
                          <button
                            type="button"
                            className="icon-btn plain"
                            disabled={!!busy}
                            title={t("Restore everything")}
                            aria-label={t("Restore everything from {date}", { date: b.when })}
                            onClick={() => {
                              setPassword("");
                              setPwError(null);
                              setRestoring(b);
                            }}
                          >
                            <ArchiveRestore size={15} aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="icon-btn plain"
                            disabled={!!busy}
                            title={t("Delete")}
                            aria-label={t("Delete backup from {date}", { date: b.when })}
                            onClick={() => void remove(b)}
                          >
                            <Trash2 size={15} aria-hidden />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="hint" style={{ textAlign: "center", padding: "2rem" }}>
                    {t("No backups yet.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="hint">
          {isOwner
            ? t("“Open” restores single pages or accounts. Restoring everything replaces the whole wiki.")
            : t(
                "“Open” restores single pages, and accounts of editors and viewers. Only the owner can restore everything, download, upload or delete backups.",
              )}
        </p>
      </section>

      {/* ---------------------------------------------- inside one backup */}
      <Modal open={!!inside} onClose={() => setInside(null)} labelledBy="inside-h" wide>
        {inside && (
          <div className="confirm-box">
            <div className="row between">
              <h2 id="inside-h" style={{ margin: 0 }}>
                {t("Backup from {date}", { date: inside.when })}
              </h2>
              <button type="button" className="icon-btn plain" aria-label={t("Close")} onClick={() => setInside(null)}>
                <X size={18} aria-hidden />
              </button>
            </div>
            <div className="inside-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "pages"}
                className={`btn sm ${tab === "pages" ? "" : "ghost"}`}
                onClick={() => setTab("pages")}
              >
                <FileText size={15} aria-hidden /> {t("Pages")} ({inside.pages.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "users"}
                className={`btn sm ${tab === "users" ? "" : "ghost"}`}
                onClick={() => setTab("users")}
              >
                <UserRound size={15} aria-hidden /> {t("Accounts")} ({inside.users.length})
              </button>
              <input
                className="input"
                style={{ maxWidth: "16rem", marginLeft: "auto" }}
                placeholder={t("Filter")}
                aria-label={t("Filter")}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <div className="table-wrap inside-list">
              <table className="data">
                <tbody>
                  {tab === "pages" &&
                    shown.pages.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.title}
                          <div className="meta mono">
                            /w/{p.slug} · {t("version {n}", { n: p.rev })}
                          </div>
                        </td>
                        <td>
                          <span className={`badge${p.exists ? "" : " danger"}`}>
                            {p.exists ? t("exists") : t("deleted")}
                          </span>
                        </td>
                        <td className="right">
                          <button
                            type="button"
                            className="btn ghost sm"
                            disabled={!!busy}
                            onClick={() => void restorePage(p)}
                          >
                            <RotateCcw size={15} aria-hidden />
                            {t("Restore")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  {tab === "users" &&
                    shown.users.map((u) => {
                      const allowed = !u.exists && (isOwner || u.role !== "admin");
                      return (
                        <tr key={u.id}>
                          <td>
                            {u.username}
                            <div className="meta">{u.email}</div>
                          </td>
                          <td>
                            <span className="badge">
                              {t(u.role === "admin" ? "Administrator" : u.role === "editor" ? "Editor" : "Viewer")}
                            </span>{" "}
                            <span className={`badge${u.exists ? "" : " danger"}`}>
                              {u.exists ? t("exists") : t("deleted")}
                            </span>
                          </td>
                          <td className="right">
                            <button
                              type="button"
                              className="btn ghost sm"
                              disabled={!!busy || !allowed}
                              title={
                                u.exists
                                  ? t("Only deleted accounts can be restored.")
                                  : !allowed
                                    ? t("Only the owner can restore administrators.")
                                    : undefined
                              }
                              onClick={() => void restoreUser(u)}
                            >
                              <RotateCcw size={15} aria-hidden />
                              {t("Restore")}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  {((tab === "pages" && !shown.pages.length) || (tab === "users" && !shown.users.length)) && (
                    <tr>
                      <td className="hint" style={{ textAlign: "center", padding: "1.5rem" }}>
                        {t("Nothing found.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {/* ---------------------------------------------- restore everything */}
      <Modal open={!!restoring} onClose={() => busy !== "restore" && setRestoring(null)} labelledBy="restore-h">
        {restoring && (
          <form
            className="confirm-box"
            onSubmit={(e) => {
              e.preventDefault();
              void restoreAll();
            }}
          >
            <h2 id="restore-h">
              <AlertTriangle size={20} aria-hidden />
              {t("Restore the backup from {date}?", { date: restoring.when })}
            </h2>
            <div className="confirm-body">
              <ul className="plain-list">
                <li>
                  {t(
                    "The whole wiki is replaced: pages, history, trash, accounts, settings, files and the security log.",
                  )}
                </li>
                <li>
                  {t(
                    "Everything since then is lost from the live wiki — but a safety backup of the current state is made first, so you can go back.",
                  )}
                </li>
                <li>
                  {t(
                    "Everyone is signed out, you too. Sign in with the password that was valid at the time of the backup.",
                  )}
                </li>
                <li>{t("Where backups are stored stays as it is now.")}</li>
              </ul>
            </div>
            <div className="field">
              <label htmlFor="restore-pw">{t("Your password")}</label>
              <input
                id="restore-pw"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
            </div>
            {pwError && (
              <p className="error-text" role="alert">
                {pwError}
              </p>
            )}
            <div className="confirm-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setRestoring(null)}
                disabled={busy === "restore"}
              >
                {t("Cancel")}
              </button>
              <button type="submit" className="btn danger solid" disabled={!password || busy === "restore"}>
                {busy === "restore" ? t("Restoring…") : t("Restore backup")}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <section className="panel">
        <h2 className="section-title">{t("What a backup contains")}</h2>
        <p>
          {t(
            "Every page with its complete version history, the trash, all accounts (password hashes, two-factor devices), settings, legal texts, the security log and every uploaded file. Not included: sign-ins (a restore signs everyone out).",
          )}
        </p>
        <p className="hint">
          {t(
            "Backups are encrypted (AES-256-GCM) with a key derived from the master key before they leave the database: the storage only ever sees ciphertext. Without WIKI_MASTER_KEY or master.key, no backup can be read — keep a copy of it somewhere safe, separately from the backups.",
          )}
        </p>
      </section>
    </div>
  );
}

/* ----------------------------------------------------------- storage */

function StoragePanel({
  target,
  isOwner,
  onSaved,
  toast,
}: {
  target: Target;
  isOwner: boolean;
  onSaved: () => void;
  toast: (m: { ok: boolean; text: string }) => void;
}) {
  const t = useT();
  const [kind, setKind] = useState(target.kind);
  const [s3, setS3] = useState({ ...target.s3, secret: "" });
  const [dir, setDir] = useState(target.localCustom);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const changed =
    kind !== target.kind ||
    (kind === "local" && dir.trim() !== target.localCustom) ||
    (kind === "s3" &&
      (s3.endpoint !== target.s3.endpoint ||
        s3.region !== target.s3.region ||
        s3.bucket !== target.s3.bucket ||
        s3.prefix !== target.s3.prefix ||
        s3.access_key !== target.s3.access_key ||
        s3.path_style !== target.s3.path_style ||
        !!s3.secret));

  const save = async () => {
    setBusy("save");
    setErr(null);
    const r = await call("/api/backups/target", "PUT", {
      password,
      target: kind,
      ...(kind === "local" ? { dir: dir.trim() } : {}),
      ...(kind === "s3"
        ? {
            s3: {
              endpoint: s3.endpoint.trim(),
              region: s3.region.trim(),
              bucket: s3.bucket.trim(),
              prefix: s3.prefix.trim(),
              access_key: s3.access_key.trim(),
              path_style: s3.path_style,
              secret: s3.secret || undefined,
            },
          }
        : {}),
    });
    setBusy(null);
    if (!r.ok) return setErr(t(r.data.error ?? "Couldn’t save."));
    setPassword("");
    toast({ ok: true, text: t("Storage tested and saved.") });
    onSaved();
  };
  const test = async () => {
    setBusy("test");
    const r = await call<{ where: string }>("/api/backups/target", "PUT", { action: "test" });
    setBusy(null);
    toast(
      r.ok
        ? { ok: true, text: t("The backup storage works ({where}).", { where: r.data.where }) }
        : { ok: false, text: t(r.data.error ?? "Something went wrong.") },
    );
  };

  return (
    <section className="panel" style={{ gridColumn: "1 / -1" }}>
      <h2 className="section-title">{t("Where backups are stored")}</h2>
      <div className="seg" role="radiogroup" aria-label={t("Where backups are stored")}>
        <label className={`seg-opt${kind === "local" ? " on" : ""}`}>
          <input
            type="radio"
            name="bk-kind"
            checked={kind === "local"}
            disabled={!isOwner}
            onChange={() => setKind("local")}
          />
          <HardDrive size={16} aria-hidden /> {t("Folder (local disk, NAS via SMB or NFS)")}
        </label>
        <label className={`seg-opt${kind === "s3" ? " on" : ""}`}>
          <input
            type="radio"
            name="bk-kind"
            checked={kind === "s3"}
            disabled={!isOwner}
            onChange={() => setKind("s3")}
          />
          <Cloud size={16} aria-hidden /> {t("S3-compatible storage")}
        </label>
      </div>
      {kind === "local" ? (
        <>
          <div className="field" style={{ maxWidth: "32rem" }}>
            <label htmlFor="bk-dir">{t("Folder")}</label>
            <input
              id="bk-dir"
              className="input mono"
              value={dir}
              placeholder={target.localDefault}
              disabled={!isOwner}
              autoComplete="off"
              spellCheck={false}
              maxLength={255}
              onChange={(e) => {
                setDir(e.target.value);
                setErr(null);
              }}
            />
          </div>
          <p className="hint">
            {t(
              "Empty: the default folder {dir}. Another folder must lie inside {roots}, already exist and belong to the user the wiki runs as — a disk or NAS share is mounted there in docker.yaml.",
              { dir: target.localDefault, roots: target.localRoots.join(", ") || "—" },
            )}
          </p>
          {target.sameVolume && (
            <div className="notice">
              <div>
                {t(
                  "The backups are on the same volume as the wiki. If that disk fails, both are gone: choose a folder on another disk or a NAS share, or use S3.",
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="form-grid">
          {(
            [
              ["endpoint", t("Endpoint"), "https://s3.eu-central-1.amazonaws.com"],
              ["region", t("Region"), "eu-central-1"],
              ["bucket", t("Bucket"), "my-wiki-backups"],
              ["prefix", t("Folder in the bucket"), "tidewiki/"],
              ["access_key", t("Access key"), ""],
            ] as const
          ).map(([k, label, ph]) => (
            <div className="field" key={k}>
              <label htmlFor={`s3-${k}`}>{label}</label>
              <input
                id={`s3-${k}`}
                className="input"
                value={s3[k]}
                placeholder={ph}
                disabled={!isOwner}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setS3({ ...s3, [k]: e.target.value })}
              />
            </div>
          ))}
          <div className="field">
            <label htmlFor="s3-secret">{t("Secret key")}</label>
            <input
              id="s3-secret"
              className="input"
              type="password"
              value={s3.secret}
              disabled={!isOwner}
              autoComplete="new-password"
              placeholder={target.s3.secret_set ? t("unchanged") : ""}
              onChange={(e) => setS3({ ...s3, secret: e.target.value })}
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={s3.path_style}
              disabled={!isOwner}
              onChange={(e) => setS3({ ...s3, path_style: e.target.checked })}
            />
            {t("Path-style addresses (MinIO, Garage, most self-hosted servers)")}
          </label>
        </div>
      )}
      {isOwner && changed && (
        <p className="hint">{t("Existing backups stay where they are and show up again when you switch back.")}</p>
      )}
      {isOwner && changed && (
        <form
          className="row"
          style={{ marginTop: ".8rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="sr-only" htmlFor="bk-pw">
            {t("Your password")}
          </label>
          <input
            id="bk-pw"
            className="input"
            type="password"
            autoComplete="current-password"
            placeholder={t("Your password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ maxWidth: "16rem" }}
          />
          <button type="submit" className="btn sm" disabled={!password || !!busy}>
            {busy === "save" ? t("Testing…") : t("Test and save")}
          </button>
        </form>
      )}
      {err && (
        <p className="error-text" role="alert">
          {err}
        </p>
      )}
      <div className="row" style={{ marginTop: ".6rem" }}>
        <span className="hint">{t("Currently: {where}", { where: target.where })}</span>
        {isOwner && (
          <button type="button" className="btn ghost sm" disabled={!!busy} onClick={() => void test()}>
            {busy === "test" ? t("Testing…") : t("Test connection")}
          </button>
        )}
      </div>
      {!isOwner && <p className="hint">{t("Only the owner can change where backups are stored.")}</p>}
    </section>
  );
}
