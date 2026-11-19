import { api, json } from "@/lib/api";
import { deleteUser, isRole, updateUser, type UserPatch } from "@/lib/admin";
import { HttpError, str } from "@/lib/validate";
export const dynamic = "force-dynamic";

type P = { id: string };
const idOf = (s: string) => {
  if (!/^\d{1,9}$/.test(s)) throw new HttpError(404, "User not found.");
  return Number(s);
};
const ACTIONS = ["unlock", "reset2fa", "revoke_sessions", "transfer_ownership"] as const;

export const PATCH = api<P>("admin", async ({ body, user, ip, params }) => {
  const b = await body();
  const patch: UserPatch = {};
  if (b.username !== undefined) patch.username = str(b.username, "Username", { max: 32 });
  if (b.email !== undefined) patch.email = str(b.email, "E-mail", { max: 254 });
  if (b.password !== undefined) patch.password = str(b.password, "Password", { max: 256, trim: false });
  if (b.role !== undefined) {
    if (!isRole(b.role)) throw new HttpError(400, "Unknown role.");
    patch.role = b.role;
  }
  if (b.disabled !== undefined) {
    if (typeof b.disabled !== "boolean") throw new HttpError(400, "Bad request.");
    patch.disabled = b.disabled;
  }
  if (b.action !== undefined) {
    if (!(ACTIONS as readonly unknown[]).includes(b.action)) throw new HttpError(400, "Unknown action.");
    patch.action = b.action as UserPatch["action"];
  }
  for (const k of Object.keys(b))
    if (!["username", "email", "password", "role", "disabled", "action"].includes(k))
      throw new HttpError(400, "Bad request.");
  await updateUser(user!.id, idOf(params.id), patch, ip);
  return json({ ok: true });
});

export const DELETE = api<P>("admin", async ({ user, ip, params }) => {
  await deleteUser(user!.id, idOf(params.id), ip);
  return json({ ok: true });
});
