import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { api } from "@/lib/api";
import { getMediaByName, MEDIA_DIR } from "@/lib/media";
import { HttpError } from "@/lib/validate";
export const dynamic = "force-dynamic";

const NAME = /^[A-Za-z0-9_-]{16,40}\.(?:png|jpg|gif|webp|mp4|webm|ogv|mov)$/;

// Uploaded files. Same read permission as the wiki itself; served with a sandbox CSP so a file can
// never run script even if a browser were tricked into rendering it as a document.
export const GET = api<{ name: string }>(
  "public",
  async ({ params, req }) => {
    if (!NAME.test(params.name)) throw new HttpError(404, "File not found.");
    const m = await getMediaByName(params.name);
    if (!m) throw new HttpError(404, "File not found.");
    const file = path.join(/* turbopackIgnore: true */ MEDIA_DIR(), m.name);
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      throw new HttpError(404, "File not found.");
    }

    const headers: Record<string, string> = {
      "Content-Type": m.mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Disposition": `inline; filename="${m.name}"`,
      "Referrer-Policy": "no-referrer",
    };
    const range = req.headers.get("range");
    if (range) {
      const r = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      let start = r && r[1] !== "" ? Number(r[1]) : NaN,
        end = r && r[2] !== "" ? Number(r[2]) : size - 1;
      if (r && r[1] === "" && r[2] !== "") {
        start = Math.max(0, size - Number(r[2]));
        end = size - 1;
      }
      if (!r || !Number.isSafeInteger(start) || start > end || start >= size) {
        return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
      }
      end = Math.min(end, size - 1);
      const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
      return new Response(body, {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(end - start + 1),
        },
      });
    }
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: { ...headers, "Content-Length": String(size) },
    });
  },
  { readGate: true },
);
