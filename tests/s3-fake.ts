// A tiny S3-compatible server for tests. Every request's signature is recomputed with AWS's own
// reference signer (@smithy/signature-v4) and refused when it differs, and the payload hash the
// client signed must match the bytes that actually arrived — so this checks our SigV4 code
// against an independent implementation, not against itself.
import http from "node:http";
import { createHash } from "node:crypto";
import { SignatureV4 } from "@smithy/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { HttpRequest } from "@smithy/protocol-http";

export type FakeS3 = {
  url: string;
  objects: Map<string, Buffer>;
  requests: { method: string; path: string; ok: boolean }[];
  close: () => Promise<void>;
};

export async function startFakeS3(opts: {
  bucket: string;
  access: string;
  secret: string;
  region: string;
  pageSize?: number;
}) {
  const objects = new Map<string, Buffer>();
  const requests: FakeS3["requests"] = [];
  const signer = new SignatureV4({
    credentials: { accessKeyId: opts.access, secretAccessKey: opts.secret },
    region: opts.region,
    service: "s3",
    sha256: Sha256,
    uriEscapePath: false,
    applyChecksum: false,
  });
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const u = new URL(req.url!, "http://x");
    const auth = String(req.headers.authorization ?? "");
    const signedNames = /SignedHeaders=([^,]+)/.exec(auth)?.[1].split(";") ?? [];
    const headers: Record<string, string> = {};
    for (const n of signedNames) headers[n] = String(req.headers[n] ?? "");
    const amzDate = String(req.headers["x-amz-date"] ?? "");
    const date = new Date(
      `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`,
    );
    const query: Record<string, string> = {};
    u.searchParams.forEach((v, k) => (query[k] = v));
    const ref = await signer.sign(
      new HttpRequest({ method: req.method, hostname: headers.host, path: u.pathname, query, headers: { ...headers } }),
      { signingDate: date },
    );
    const payloadOk = headers["x-amz-content-sha256"] === createHash("sha256").update(body).digest("hex");
    const ok = !!auth && ref.headers.authorization === auth && payloadOk && signedNames.includes("host");
    requests.push({ method: req.method!, path: u.pathname, ok });
    if (!ok) {
      res.writeHead(403, { "content-type": "application/xml" });
      return res.end("<Error><Code>SignatureDoesNotMatch</Code></Error>");
    }
    const prefix = `/${opts.bucket}`;
    if (!u.pathname.startsWith(prefix)) {
      res.writeHead(404);
      return res.end("<Error><Code>NoSuchBucket</Code></Error>");
    }
    const key = decodeURIComponent(u.pathname.slice(prefix.length + 1));
    if (req.method === "PUT") {
      objects.set(key, body);
      res.writeHead(200);
      return res.end();
    }
    if (req.method === "GET" && u.pathname === prefix) {
      const p = u.searchParams.get("prefix") ?? "";
      const all = [...objects.keys()].filter((k) => k.startsWith(p) && !k.slice(p.length).includes("/")).sort();
      const start = Number(u.searchParams.get("continuation-token") ?? 0);
      const size = opts.pageSize ?? 1000;
      const page = all.slice(start, start + size);
      const more = start + size < all.length;
      const xml =
        `<?xml version="1.0"?><ListBucketResult>` +
        page
          .map(
            (k) => `<Contents><Key>${k.replace(/&/g, "&amp;")}</Key><Size>${objects.get(k)!.length}</Size></Contents>`,
          )
          .join("") +
        `<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + size}</NextContinuationToken>` : ""}</ListBucketResult>`;
      res.writeHead(200, { "content-type": "application/xml" });
      return res.end(xml);
    }
    const obj = objects.get(key);
    if (req.method === "GET" || req.method === "HEAD") {
      if (!obj) {
        res.writeHead(404);
        return res.end(req.method === "GET" ? "<Error><Code>NoSuchKey</Code></Error>" : undefined);
      }
      res.writeHead(200, { "content-length": obj.length });
      return res.end(req.method === "GET" ? obj : undefined);
    }
    if (req.method === "DELETE") {
      objects.delete(key);
      res.writeHead(204);
      return res.end();
    }
    res.writeHead(405);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    objects,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  } satisfies FakeS3;
}
