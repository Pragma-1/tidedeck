import { api, json } from "@/lib/api";
import { audit } from "@/lib/audit";
import { deleteMediaMany, listMedia, mediaUsage, storeUpload } from "@/lib/media";
import { consume } from "@/lib/rate-limit";
import { HttpError } from "@/lib/validate";
export const dynamic = "force-dynamic";

export const GET = api("admin", async () => json({ files: await listMedia(), ...(await mediaUsage()) }));

// Raw request body = the file. Type is decided by the file's own bytes, never by headers or the name.
export const POST = api("editor", async ({ req, user, ip }) => {
  if (!(await consume(`upload:${user!.id}`, 60, 3600))) throw new HttpError(429, "Too many uploads. Try again later.");
  if (!req.body) throw new HttpError(400, "Empty request.");
  const declared = Number(req.headers.get("content-length") || 0);
  const m = await storeUpload(req.body, declared, req.nextUrl.searchParams.get("name"), user!.id);
  await audit("media.uploaded", user!.id, ip, `${m.name} (${m.mime}, ${Math.round(m.size / 1024)} KB)`);
  return json({ url: `/media/${m.name}`, kind: m.kind, name: m.original_name }, 201);
});

/**
 * Deletes several files at once, for good (row, file on disk, traces in the database files).
 * Body: { ids: [1, 2, …] } (at most 1000). Uploaders delete their own files, administrators any;
 * all or nothing.
 */
export const DELETE = api("editor", async ({ body, user, ip }) => {
  if (!(await consume(`media-delete:${user!.id}`, 60, 600))) throw new HttpError(429, "Slow down a little.");
  const b = await body(64 * 1024);
  if (!Array.isArray(b.ids) || b.ids.length === 0) throw new HttpError(400, "Select at least one file.", "ids");
  if (b.ids.length > 1000) throw new HttpError(400, "Select at most 1000 files at once.", "ids");
  const ids = [...new Set(b.ids as unknown[])].map((x) => {
    if (typeof x !== "number" || !Number.isSafeInteger(x) || x < 1) throw new HttpError(400, "Invalid file.", "ids");
    return x;
  });
  const gone = await deleteMediaMany(ids, user!);
  for (const m of gone) await audit("media.deleted", user!.id, ip, m.name);
  return json({ deleted: gone.length, missing: ids.length - gone.length, bytes: gone.reduce((a, m) => a + m.size, 0) });
});
