import { api, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { all, sql } from "@/lib/db";
import { deleteBackup, getManifest } from "@/lib/backup";
import { assertOwner, backupId } from "@/lib/backup-auth";
export const dynamic = "force-dynamic";

/** What's inside one backup: its pages and accounts, each marked whether it exists right now. */
export const GET = api<{ id: string }>("admin", async ({ params }) => {
  const m = await getManifest(backupId(params.id));
  const livePages = new Set(
    (await all<{ id: number }>(sql`SELECT id FROM pages WHERE id = ANY(${m.pages.map((p) => p.id)}::bigint[])`)).map(
      (r) => r.id,
    ),
  );
  const liveUsers = new Set(
    (await all<{ id: number }>(sql`SELECT id FROM users WHERE id = ANY(${m.users.map((u) => u.id)}::bigint[])`)).map(
      (r) => r.id,
    ),
  );
  return json({
    id: m.id,
    created_at: m.created_at,
    reason: m.reason,
    counts: m.counts,
    pages: m.pages.map((p) => ({ ...p, exists: livePages.has(p.id) })),
    users: m.users.map(({ id, username, email, role, disabled }) => ({
      id,
      username,
      email,
      role,
      disabled,
      exists: liveUsers.has(id),
    })),
  });
});

export const DELETE = api<{ id: string }>("admin", async ({ user, params, ip }) => {
  assertOwner(user);
  const m = await deleteBackup(backupId(params.id));
  await audit("admin.backup_deleted", user!.id, ip, m.id);
  return json({ ok: true });
});
