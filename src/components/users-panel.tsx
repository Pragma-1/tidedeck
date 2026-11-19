"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Crown,
  Download,
  KeyRound,
  LockOpen,
  LogOut,
  Pencil,
  Shield,
  ShieldOff,
  Trash2,
  UserPlus,
  Wand2,
  X,
} from "lucide-react";
import { call } from "@/lib/client-api";
import { ROLE_LABELS } from "@/lib/roles";
import type { AdminUser } from "@/lib/admin";
import { Actions, Field, Notice, PasswordInput, useToast } from "./ui";
import { PasswordRules } from "./password-rules";
import { useConfirm, type ConfirmOptions } from "./confirm";
import { policyChecks, type PasswordPolicy } from "@/lib/password-policy";
import { useDate, useT } from "./i18n";

type Me = { id: number; isOwner: boolean };
type Role = AdminUser["role"];

/** A random password for "set password" / "new user" that satisfies the policy (shown once, never stored in plain). */
function generatePassword(policy: PasswordPolicy): string {
  // 56 symbols: 256 % 56 bias is irrelevant at this length; rejection sampling keeps it uniform anyway.
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = (n: number) => {
    let out = "";
    while (out.length < n)
      for (const b of crypto.getRandomValues(new Uint8Array(n * 2)))
        if (b < 224 && out.length < n) out += alphabet[b % 56];
    return out;
  };
  const groups = Math.max(4, Math.ceil(Math.max(policy.minLength, 20) / 6));
  for (let i = 0; i < 200; i++) {
    const pw = Array.from({ length: groups }, () => pick(5)).join("-");
    if (policyChecks(pw, policy).every((c) => c.ok)) return pw;
  }
  // Extremely strict policies: append what is missing.
  const base = Array.from({ length: groups }, () => pick(5)).join("-");
  return (
    base + "7".repeat(policy.digits) + "#".repeat(policy.special) + "Q".repeat(policy.upper) + "q".repeat(policy.lower)
  );
}

const canManage = (me: Me, u: AdminUser) => u.id === me.id || (!u.is_owner && (u.role !== "admin" || me.isOwner));

function RoleSelect({
  id,
  value,
  onChange,
  allowAdmin,
  disabled,
}: {
  id: string;
  value: Role;
  onChange: (r: Role) => void;
  allowAdmin: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <select
      id={id}
      className="input"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Role)}
    >
      {(allowAdmin || value === "admin") && <option value="admin">{t(ROLE_LABELS.admin)}</option>}
      <option value="editor">{t(ROLE_LABELS.editor)}</option>
      <option value="viewer">{t(ROLE_LABELS.viewer)}</option>
    </select>
  );
}

function NewPassword({
  id,
  value,
  onChange,
  policy,
  optional,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  policy: PasswordPolicy;
  optional?: boolean;
}) {
  const t = useT();
  return (
    <div className="field">
      <div className="label-row">
        <label htmlFor={id}>{optional ? t("New password (optional)") : t("Password")}</label>
        <button type="button" className="small-link" onClick={() => onChange(generatePassword(policy))}>
          <Wand2 size={14} aria-hidden /> {t("Generate")}
        </button>
      </div>
      <PasswordInput
        id={id}
        value={value}
        onChange={onChange}
        autoComplete="new-password"
        required={!optional}
        describedBy={`${id}-rules`}
      />
      {(!optional || value) && <PasswordRules id={`${id}-rules`} value={value} policy={policy} />}
      <span className="hint">{t("Pass it on securely — the person should change it after signing in.")}</span>
    </div>
  );
}

function CreateUser({ me, policy, onDone }: { me: Me; policy: PasswordPolicy; onDone: (text: string) => void }) {
  const t = useT();
  const [f, setF] = useState({ username: "", email: "", role: "editor" as Role, password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call("/api/users", "POST", f);
    setBusy(false);
    if (r.ok) onDone(t("User {name} created.", { name: f.username }));
    else setError(t(r.data.error ?? "Something went wrong."));
  };
  return (
    <form className="panel inset" onSubmit={submit}>
      <h3>{t("Add user")}</h3>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="cols-3">
        <Field id="nu-name" label={t("Username")}>
          <input
            className="input"
            id="nu-name"
            value={f.username}
            onChange={(e) => setF({ ...f, username: e.target.value })}
            required
            maxLength={32}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
        <Field id="nu-mail" label={t("E-mail")}>
          <input
            className="input"
            id="nu-mail"
            type="email"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
            required
            maxLength={254}
            autoComplete="off"
          />
        </Field>
        <Field id="nu-role" label={t("Role")}>
          <RoleSelect id="nu-role" value={f.role} onChange={(role) => setF({ ...f, role })} allowAdmin={me.isOwner} />
        </Field>
      </div>
      <NewPassword id="nu-pw" value={f.password} onChange={(password) => setF({ ...f, password })} policy={policy} />
      <Actions>
        <button type="button" className="btn ghost" onClick={() => onDone("")}>
          {t("Cancel")}
        </button>
        <button className="btn" disabled={busy}>
          <UserPlus size={16} aria-hidden />
          {busy ? t("Creating…") : t("Create user")}
        </button>
      </Actions>
    </form>
  );
}

type Act = (body: unknown, done: string, confirm?: ConfirmOptions) => Promise<void>;

function EditUser({
  u,
  me,
  policy,
  onDone,
  act,
}: {
  u: AdminUser;
  me: Me;
  policy: PasswordPolicy;
  onDone: (text: string) => void;
  act: Act;
}) {
  const t = useT();
  const self = u.id === me.id;
  const [f, setF] = useState({ username: u.username, email: u.email, role: u.role, password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    if (f.username !== u.username) body.username = f.username;
    if (f.email !== u.email) body.email = f.email;
    if (f.role !== u.role) body.role = f.role;
    if (f.password) body.password = f.password;
    if (!Object.keys(body).length) {
      onDone("");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await call(`/api/users/${u.id}`, "PATCH", body);
    setBusy(false);
    if (r.ok) onDone(t("Changes to {name} saved.", { name: f.username }));
    else setError(t(r.data.error ?? "Something went wrong."));
  };
  return (
    <form className="panel inset" onSubmit={submit}>
      <div className="row between">
        <h3>{t("Edit {name}", { name: u.username })}</h3>
        <button type="button" className="icon-btn plain" aria-label={t("Close")} onClick={() => onDone("")}>
          <X size={18} aria-hidden />
        </button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="cols-3">
        <Field id={`eu-name-${u.id}`} label={t("Username")}>
          <input
            className="input"
            id={`eu-name-${u.id}`}
            value={f.username}
            onChange={(e) => setF({ ...f, username: e.target.value })}
            required
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field id={`eu-mail-${u.id}`} label={t("E-mail")}>
          <input
            className="input"
            id={`eu-mail-${u.id}`}
            type="email"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
            required
            maxLength={254}
            autoComplete="off"
          />
        </Field>
        <Field id={`eu-role-${u.id}`} label={t("Role")} hint={self ? t("You can’t change your own role.") : undefined}>
          <RoleSelect
            id={`eu-role-${u.id}`}
            value={f.role}
            onChange={(role) => setF({ ...f, role })}
            allowAdmin={me.isOwner}
            disabled={self}
          />
        </Field>
      </div>
      <NewPassword
        id={`eu-pw-${u.id}`}
        value={f.password}
        onChange={(password) => setF({ ...f, password })}
        policy={policy}
        optional
      />
      <div className="tool-row">
        {u.locked_until && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => void act({ action: "unlock" }, t("{name} can sign in again.", { name: u.username }))}
          >
            <LockOpen size={15} aria-hidden />
            {t("Unlock now")}
          </button>
        )}
        {!!u.totp_enabled && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() =>
              void act({ action: "reset2fa" }, t("Two-factor removed for {name}.", { name: u.username }), {
                title: t("Remove two-factor from {name}?", { name: u.username }),
                body: t(
                  "All authenticator devices and recovery codes of this account are deleted, and the person is signed out.",
                ),
                confirmLabel: t("Reset 2FA"),
                danger: true,
              })
            }
          >
            <ShieldOff size={15} aria-hidden />
            {t("Reset 2FA")}
          </button>
        )}
        <button
          type="button"
          className="btn ghost sm"
          onClick={() =>
            void act({ action: "revoke_sessions" }, t("{name} was signed out everywhere.", { name: u.username }))
          }
        >
          <LogOut size={15} aria-hidden />
          {t("Sign out everywhere")}
        </button>
        {!self && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() =>
              void act(
                { disabled: !u.disabled },
                u.disabled ? t("{name} enabled.", { name: u.username }) : t("{name} disabled.", { name: u.username }),
              )
            }
          >
            {u.disabled ? <Shield size={15} aria-hidden /> : <ShieldOff size={15} aria-hidden />}
            {u.disabled ? t("Enable") : t("Disable")}
          </button>
        )}
        <a className="btn ghost sm" href={`/api/users/${u.id}/export`} download>
          <Download size={15} aria-hidden />
          {t("Export personal data")}
        </a>
        {me.isOwner && !self && u.role === "admin" && !u.disabled && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() =>
              void act({ action: "transfer_ownership" }, t("{name} now owns the wiki.", { name: u.username }), {
                title: t("Hand over ownership?"),
                body: t("Make {name} the owner? You stay an administrator but lose owner rights.", {
                  name: u.username,
                }),
                confirmLabel: t("Make owner"),
                danger: true,
              })
            }
          >
            <Crown size={15} aria-hidden />
            {t("Make owner")}
          </button>
        )}
        {!self && (
          <button
            type="button"
            className="btn danger sm"
            onClick={() =>
              void act("DELETE", t("{name} and all their personal data were deleted.", { name: u.username }), {
                title: t("Delete user {name}?", { name: u.username }),
                body: t("Delete {name} and all their personal data? Their pages stay. This can’t be undone.", {
                  name: u.username,
                }),
                confirmLabel: t("Delete permanently"),
                danger: true,
                typeToConfirm: u.username,
              })
            }
          >
            <Trash2 size={15} aria-hidden />
            {t("Delete")}
          </button>
        )}
      </div>
      <Actions>
        <button type="button" className="btn ghost" onClick={() => onDone("")}>
          {t("Cancel")}
        </button>
        <button className="btn" disabled={busy}>
          {busy ? t("Saving…") : t("Save changes")}
        </button>
      </Actions>
    </form>
  );
}

export function UsersPanel({ users, me, policy }: { users: AdminUser[]; me: Me; policy: PasswordPolicy }) {
  const t = useT();
  const date = useDate();
  const router = useRouter();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const toast = useToast();
  const setNote = toast.show;
  const [filter, setFilter] = useState("");
  const [dialog, confirm] = useConfirm();
  const done = (text: string) => {
    setEditing(null);
    if (text) {
      setNote({ ok: true, text });
      router.refresh();
    }
  };
  const act =
    (u: AdminUser): Act =>
    async (body, doneText, opts) => {
      if (opts && !(await confirm(opts))) return;
      const r =
        body === "DELETE"
          ? await call(`/api/users/${u.id}`, "DELETE")
          : await call(`/api/users/${u.id}`, "PATCH", body);
      if (!r.ok) {
        setNote({ ok: false, text: t(r.data.error ?? "Something went wrong.") });
        return;
      }
      done(doneText);
    };
  const shown = users.filter((u) => !filter || `${u.username} ${u.email}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <section>
      <div className="row between section-head">
        <p className="hint" style={{ margin: 0, maxWidth: "60ch" }}>
          {me.isOwner
            ? t("As owner you can manage everyone, including administrators.")
            : t("You can manage editors and viewers. Only the owner can manage administrators.")}
        </p>
        <div className="row">
          <input
            className="input"
            style={{ width: "14rem" }}
            type="search"
            placeholder={t("Filter people")}
            aria-label={t("Filter people")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button type="button" className="btn" onClick={() => setEditing("new")}>
            <UserPlus size={16} aria-hidden />
            {t("Add user")}
          </button>
        </div>
      </div>
      {toast.node}
      {dialog}
      {editing === "new" && <CreateUser me={me} policy={policy} onDone={done} />}
      <div className="table-wrap">
        <table className="data users">
          <thead>
            <tr>
              <th>{t("User")}</th>
              <th>{t("Role")}</th>
              <th>{t("Status")}</th>
              <th>{t("2FA")}</th>
              <th>{t("Last sign-in")}</th>
              <th>
                <span className="sr-only">{t("Actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <UserRow
                key={u.id}
                u={u}
                me={me}
                date={date}
                editing={editing === u.id}
                onEdit={() => setEditing(editing === u.id ? null : u.id)}
                editor={<EditUser u={u} me={me} policy={policy} onDone={done} act={act(u)} />}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UserRow({
  u,
  me,
  date,
  editing,
  onEdit,
  editor,
}: {
  u: AdminUser;
  me: Me;
  date: (ts: number) => string;
  editing: boolean;
  onEdit: () => void;
  editor: React.ReactNode;
}) {
  const t = useT();
  const manage = canManage(me, u);
  return (
    <>
      <tr className={editing ? "open" : undefined}>
        <td>
          <strong>{u.username}</strong>
          {u.id === me.id && <span className="hint"> ({t("you")})</span>}
          <br />
          <span className="hint">{u.email}</span>
        </td>
        <td>
          <span className="badge">{t(ROLE_LABELS[u.role])}</span>
          {!!u.is_owner && (
            <>
              {" "}
              <span className="badge owner">
                <Crown size={12} aria-hidden /> {t("Owner")}
              </span>
            </>
          )}
        </td>
        <td>
          {u.disabled ? (
            <span className="badge warn">{t("disabled")}</span>
          ) : u.locked_until ? (
            <span className="badge danger" title={date(u.locked_until)}>
              <KeyRound size={12} aria-hidden /> {t("locked until {time}", { time: date(u.locked_until) })}
            </span>
          ) : (
            <span className="hint">{t("active")}</span>
          )}
        </td>
        <td>{u.totp_enabled ? <span className="badge">{t("on")}</span> : <span className="hint">{t("off")}</span>}</td>
        <td className="nowrap">{u.last_login ? date(u.last_login) : <span className="hint">{t("never")}</span>}</td>
        <td className="right">
          {manage ? (
            <button type="button" className="btn ghost sm" aria-expanded={editing} onClick={onEdit}>
              <Pencil size={15} aria-hidden />
              {t("Edit")}
            </button>
          ) : (
            <span className="hint" title={t("Only the owner can manage administrators.")}>
              —
            </span>
          )}
        </td>
      </tr>
      {editing && (
        <tr className="editor-row">
          <td colSpan={6}>{editor}</td>
        </tr>
      )}
    </>
  );
}
