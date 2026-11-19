import { api, json } from "@/lib/api";
import { removeDevice, renameDevice } from "@/lib/auth";
import { HttpError, str } from "@/lib/validate";
export const dynamic = "force-dynamic";

const deviceId = (raw: string) => {
  if (!/^\d{1,9}$/.test(raw)) throw new HttpError(404, "That device no longer exists.");
  return Number(raw);
};

// Only the person's own devices: every query is scoped to user_id, so other ids simply don't exist.
export const DELETE = api<{ id: string }>(
  "user",
  async ({ body, user, ip, params }) => {
    const b = await body();
    await removeDevice(user!, deviceId(params.id), str(b.password, "Password", { max: 256, trim: false }), ip);
    return json({ ok: true });
  },
  { allowPending2fa: true },
);

export const PATCH = api<{ id: string }>(
  "user",
  async ({ body, user, ip, params }) => {
    const b = await body();
    await renameDevice(user!, deviceId(params.id), b.name, ip);
    return json({ ok: true });
  },
  { allowPending2fa: true },
);
