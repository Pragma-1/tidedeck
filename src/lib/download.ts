/** A file download response. The name is ASCII-only, so no header injection is possible. */
export function download(body: string, filename: string, type: string): Response {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(body, {
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
