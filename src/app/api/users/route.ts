import { api, json } from "@/lib/api";
import { createUser, isRole, listUsers } from "@/lib/admin";
import { HttpError, str } from "@/lib/validate";
export const dynamic = "force-dynamic";

export const GET = api("admin", async () => json(await listUsers()));

export const POST = api("admin", async ({ body, user, ip }) => {
  const b = await body();
  if (!isRole(b.role)) throw new HttpError(400, "Unknown role.", "role");
  const id = await createUser(
    user!.id,
    {
      username: str(b.username, "Username", { max: 32 }),
      email: str(b.email, "E-mail", { max: 254 }),
      password: str(b.password, "Password", { max: 256, trim: false }),
      role: b.role,
    },
    ip,
  );
  return json({ id }, 201);
});
