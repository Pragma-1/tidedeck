import {
  chmodSync,
  constants as fsc,
  createReadStream,
  createWriteStream,
  fsyncSync,
  closeSync,
  lstatSync,
  openSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HttpError } from "./validate";
import { forbiddenAddress } from "./net-guard";

/*
 * Where backups are kept. Every key is checked against one strict pattern before it touches a
 * path or a URL, so nothing outside the backup layout can be read, written or deleted.
 *
 *   v2/<id>.manifest   v2/<id>.data   v2/objects/<64 hex>
 */

export const KEY_RE = /^v2\/(?:\d{8}-\d{6}-[0-9a-f]{6}\.(?:manifest|data)|objects\/[0-9a-f]{64})$/;
const checkKey = (k: string) => {
  if (!KEY_RE.test(k)) throw new Error(`invalid backup key: ${k.slice(0, 80)}`);
  return k;
};

export interface BackupStore {
  readonly kind: "local" | "s3";
  describe(): string;
  /** Stores a local file under key (atomically: readers never see half a file). */
  put(key: string, file: string): Promise<void>;
  get(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  list(prefix: "v2/" | "v2/objects/"): Promise<{ key: string; size: number }[]>;
  delete(key: string): Promise<void>;
}

/* ------------------------------------------------------------------ local */

/** File-system failures as messages an owner can act on; the details go to the server log. */
function fsFailure(e: unknown): never {
  if (e instanceof HttpError) throw e;
  const code = (e as NodeJS.ErrnoException)?.code;
  console.error("[backup] folder:", code ?? (e instanceof Error ? e.message : e));
  if (code === "EACCES" || code === "EPERM")
    throw new HttpError(
      503,
      "The wiki can’t write to the backup folder. It must belong to the user the wiki runs as (PUID/PGID).",
    );
  if (code === "EROFS") throw new HttpError(503, "The backup folder is read-only.");
  if (code === "ENOSPC" || code === "EDQUOT") throw new HttpError(503, "The backup folder is full.");
  if (code === "ELOOP")
    throw new HttpError(503, "The backup folder contains a link that points elsewhere. It isn’t followed.");
  throw new HttpError(503, "The backup folder can’t be used right now.");
}

/**
 * A folder: the default volume, or a disk or SMB/NFS share mounted into the container.
 *
 * Nothing below the folder may be a symbolic link — whoever can write to a NAS share must not be
 * able to make the wiki read, overwrite or delete a file elsewhere (or put its master key into a
 * download) by planting a link. A folder the owner chose (`mustExist`) is never created: a share
 * that isn't mounted must fail loudly, not quietly fill the container's own disk.
 */
export class LocalStore implements BackupStore {
  readonly kind = "local" as const;
  constructor(
    readonly root: string,
    private readonly opts: { mustExist?: boolean } = {},
  ) {}
  describe() {
    return this.root;
  }
  private ready(create: boolean) {
    let st;
    try {
      st = statSync(this.root);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") fsFailure(e);
      if (!create) return false;
      if (this.opts.mustExist) throw new HttpError(503, "The backup folder doesn’t exist. Is the share mounted?");
      try {
        mkdirSync(this.root, { recursive: true, mode: 0o700 });
      } catch (e2) {
        fsFailure(e2);
      }
      return true;
    }
    if (!st.isDirectory()) throw new HttpError(503, "The backup folder doesn’t exist. Is the share mounted?");
    return true;
  }
  private abs(key: string) {
    const p = path.resolve(/* turbopackIgnore: true */ this.root, checkKey(key));
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("path escapes the backup folder");
    return p;
  }
  /** Every existing step from the folder down to `p` must be a real directory or file, never a link. */
  private noLinks(p: string) {
    const rel = path.relative(this.root, p).split(path.sep);
    let cur = this.root;
    for (const part of rel) {
      cur = path.join(/* turbopackIgnore: true */ cur, part);
      let st;
      try {
        st = lstatSync(cur);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
        fsFailure(e);
      }
      if (st.isSymbolicLink()) fsFailure(Object.assign(new Error("link"), { code: "ELOOP" }));
    }
  }
  private ensure(dir: string) {
    this.noLinks(dir);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      /* SMB/NFS may not support modes; the mount options decide there */
    }
    this.noLinks(dir);
  }
  async put(key: string, file: string) {
    this.ready(true);
    const dst = this.abs(key);
    const tmp = `${dst}.part-${randomBytes(6).toString("hex")}`;
    try {
      this.ensure(path.dirname(dst));
      await pipeline(createReadStream(file), createWriteStream(tmp, { mode: 0o600, flags: "wx" }));
      const fd = openSync(tmp, "r");
      try {
        fsyncSync(fd); // on disk before it becomes visible
      } finally {
        closeSync(fd);
      }
      this.noLinks(dst);
      renameSync(tmp, dst); // rename replaces a link itself, never what it points to
    } catch (e) {
      rmSync(tmp, { force: true });
      fsFailure(e);
    }
  }
  async get(key: string) {
    const p = this.abs(key);
    if (!this.ready(false)) throw new HttpError(404, "Backup not found.");
    this.noLinks(p);
    let fd: number;
    try {
      fd = openSync(p, fsc.O_RDONLY | fsc.O_NOFOLLOW);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, "Backup not found.");
      fsFailure(e);
    }
    return createReadStream(p, { fd });
  }
  async exists(key: string) {
    const p = this.abs(key);
    if (!this.ready(false)) return false;
    this.noLinks(p);
    try {
      return lstatSync(p).isFile();
    } catch {
      return false;
    }
  }
  async list(prefix: "v2/" | "v2/objects/") {
    if (!this.ready(false)) {
      if (this.opts.mustExist) throw new HttpError(503, "The backup folder doesn’t exist. Is the share mounted?");
      return [];
    }
    const dir = path.join(/* turbopackIgnore: true */ this.root, prefix);
    this.noLinks(dir);
    const out: { key: string; size: number }[] = [];
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      fsFailure(e);
    }
    for (const f of entries) {
      if (!f.isFile()) continue; // links and folders are never listed
      const key = prefix + f.name;
      if (KEY_RE.test(key)) out.push({ key, size: lstatSync(path.join(/* turbopackIgnore: true */ dir, f.name)).size });
    }
    return out;
  }
  async delete(key: string) {
    const p = this.abs(key);
    if (!this.ready(false)) return;
    this.noLinks(path.dirname(p));
    try {
      rmSync(p, { force: true }); // a link would be removed itself, not its target
    } catch (e) {
      fsFailure(e);
    }
  }
}

/** Folders that can never hold backups (the container's system, or what a restart wipes). */
const SYSTEM_DIR = /^\/(?:bin|boot|dev|etc|lib|lib32|lib64|libx32|proc|root|run|sbin|sys|usr|var|tmp|app)(?:\/|$)/;
const inside = (child: string, parent: string) =>
  child === parent || child.startsWith(parent === "/" ? "/" : parent + "/");

/**
 * Checks a backup folder the owner typed in. It must be an absolute, plain path (no `..`, no
 * odd characters), lie in one of the allowed roots (WIKI_BACKUP_ROOTS), stay clear of the wiki's
 * own data and program folders, exist already, and contain no symbolic link on the way.
 * Returns the cleaned path.
 */
export function checkLocalDir(input: unknown, o: { roots: string[]; avoid: string[] }): string {
  if (typeof input !== "string")
    throw new HttpError(400, "Enter the folder as an absolute path, such as /backups.", "dir");
  let p = input.trim();
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (
    !p.startsWith("/") ||
    p.length > 255 ||
    !/^[A-Za-z0-9 ._/-]+$/.test(p) ||
    path.posix.normalize(p) !== p ||
    /(?:^|\/)\.{1,2}(?:\/|$)|\/\s|\s(?:\/|$)/.test(p)
  )
    throw new HttpError(400, "Enter the folder as an absolute path, such as /backups.", "dir");
  // a system folder only when the operator listed a root there on purpose (WIKI_BACKUP_ROOTS)
  if (p === "/" || !o.roots.some((r) => r !== "/" && inside(p, r) && (!SYSTEM_DIR.test(p) || SYSTEM_DIR.test(r))))
    throw new HttpError(400, "This folder isn’t allowed. Choose one inside the folders listed below.", "dir");
  if (o.avoid.some((a) => inside(p, a) || inside(a, p)))
    throw new HttpError(400, "Backups can’t go into the wiki’s own data or program folder.", "dir");
  let real: string;
  try {
    if (!statSync(p).isDirectory()) throw new Error("not a folder");
    real = realpathSync(p);
  } catch {
    throw new HttpError(400, "This folder doesn’t exist in the container. Mount it in docker.yaml first.", "dir");
  }
  if (real !== p) throw new HttpError(400, "The path contains a link. Enter the real folder.", "dir");
  return p;
}

/* --------------------------------------------------------------------- S3 */

export type S3Config = {
  endpoint: string; // https://s3.eu-central-1.amazonaws.com, https://minio.lan:9000, …
  region: string;
  bucket: string;
  prefix: string; // optional folder inside the bucket
  accessKey: string;
  secretKey: string;
  pathStyle: boolean;
};

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION_RE = /^[a-z0-9-]{1,40}$/;
// segments start with a letter or digit: no ".", no "..", nothing a file-backed S3 server could resolve upwards
const PREFIX_RE = /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/){0,4}$/;
const ACCESS_RE = /^[\x21-\x7e]{1,128}$/;

/** Validates S3 settings; returns the parsed endpoint. Shared by the settings API and the client. */
export function checkS3Config(c: S3Config): URL {
  let u: URL;
  try {
    u = new URL(c.endpoint);
  } catch {
    throw new HttpError(400, "Enter the S3 endpoint as a full URL (https://…).", "backup_s3_endpoint");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:")
    throw new HttpError(400, "Enter the S3 endpoint as a full URL (https://…).", "backup_s3_endpoint");
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== ""))
    throw new HttpError(
      400,
      "The S3 endpoint is only scheme, host and port — no path or credentials.",
      "backup_s3_endpoint",
    );
  if (!BUCKET_RE.test(c.bucket) || c.bucket.includes(".."))
    throw new HttpError(400, "Invalid bucket name.", "backup_s3_bucket");
  if (!REGION_RE.test(c.region)) throw new HttpError(400, "Invalid region.", "backup_s3_region");
  if (c.prefix && !PREFIX_RE.test(c.prefix))
    throw new HttpError(400, "Folder: letters, digits, dot, dash, underscore, ending with “/”.", "backup_s3_prefix");
  if (!ACCESS_RE.test(c.accessKey)) throw new HttpError(400, "Invalid access key.", "backup_s3_access_key");
  if (!c.secretKey || !ACCESS_RE.test(c.secretKey)) throw new HttpError(400, "The S3 secret key is missing.");
  return u;
}

const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const hmac = (k: Buffer | string, d: string) => createHmac("sha256", k).update(d).digest();

/** AWS Signature Version 4 for one request. Exported for the test against the reference signer. */
export function signV4(input: {
  method: string;
  host: string;
  path: string; // already URI-encoded
  query: Record<string, string>;
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  accessKey: string;
  secretKey: string;
  date: Date;
  service?: string;
}): Record<string, string> {
  const service = input.service ?? "s3";
  const amzDate = input.date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v])),
    host: input.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": input.payloadHash,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim().replace(/\s+/g, " ")}\n`).join("");
  const signed = names.join(";");
  const query = Object.keys(input.query)
    .sort()
    .map((k) => `${enc(k)}=${enc(input.query[k])}`)
    .join("&");
  const canonical = [input.method, input.path, query, canonicalHeaders, signed, input.payloadHash].join("\n");
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, hex(canonical)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${input.secretKey}`, day), input.region), service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
  };
}

const xmlText = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

export class S3Store implements BackupStore {
  readonly kind = "s3" as const;
  private readonly url: URL;
  constructor(private readonly c: S3Config) {
    this.url = checkS3Config(c);
  }
  describe() {
    return `s3://${this.c.bucket}/${this.c.prefix}`;
  }

  /** Resolves the endpoint once per request and connects to exactly that address (no DNS rebinding). */
  private async request(
    method: "GET" | "PUT" | "HEAD" | "DELETE",
    objectKey: string | null,
    query: Record<string, string> = {},
    body?: { file: string; size: number; sha256: string },
  ): Promise<{ status: number; stream: Readable; text: () => Promise<string> }> {
    const host = this.url.host;
    const hostname = this.url.hostname.replace(/^\[|\]$/g, "");
    let address: string;
    try {
      address = isIP(hostname) ? hostname : (await lookup(hostname)).address;
    } catch {
      throw new HttpError(502, "The S3 endpoint’s host name could not be resolved.");
    }
    if (forbiddenAddress(address)) throw new HttpError(400, "This S3 endpoint address is not allowed.");
    const vhost = !this.c.pathStyle;
    const reqHost = vhost ? `${this.c.bucket}.${host}` : host;
    const keyPath = objectKey === null ? "" : (this.c.prefix + checkKey(objectKey)).split("/").map(enc).join("/");
    const p = vhost ? `/${keyPath}` : `/${enc(this.c.bucket)}${objectKey === null ? "" : `/${keyPath}`}`;
    const headers = signV4({
      method,
      host: reqHost,
      path: p || "/",
      query,
      headers: body ? { "content-length": String(body.size) } : {},
      payloadHash: body ? body.sha256 : hex(""),
      region: this.c.region,
      accessKey: this.c.accessKey,
      secretKey: this.c.secretKey,
      date: new Date(),
    });
    const qs = Object.keys(query).length
      ? "?" +
        Object.keys(query)
          .sort()
          .map((k) => `${enc(k)}=${enc(query[k])}`)
          .join("&")
      : "";
    const mod = this.url.protocol === "https:" ? https : http;
    const port = Number(this.url.port || (this.url.protocol === "https:" ? 443 : 80));
    return new Promise((resolve, reject) => {
      const req = mod.request(
        {
          host: address,
          port,
          method,
          path: (p || "/") + qs,
          headers,
          servername: isIP(hostname) ? undefined : vhost ? `${this.c.bucket}.${hostname}` : hostname,
          timeout: 60_000,
          minVersion: "TLSv1.2",
        } as https.RequestOptions,
        (res) => {
          const stream = res as unknown as Readable;
          resolve({
            status: res.statusCode ?? 0,
            stream,
            text: async () => {
              let s = "";
              for await (const c of stream) {
                s += (c as Buffer).toString("utf8");
                if (s.length > 4_000_000) break; // a listing page is ~1 MB at most
              }
              return s;
            },
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("S3 request timed out")));
      req.on("error", (e) => {
        console.error("[backup] S3 connection:", e.message.slice(0, 200));
        reject(new HttpError(502, "The backup storage can’t be reached."));
      });
      if (body) createReadStream(body.file).on("error", reject).pipe(req);
      else req.end();
    });
  }

  private async fail(r: { status: number; text: () => Promise<string> }, what: string): Promise<never> {
    const t = await r.text().catch(() => "");
    const code = /<Code>([^<]{1,80})<\/Code>/.exec(t)?.[1] ?? `HTTP ${r.status}`;
    console.error(`[backup] S3 refused ${what}: ${xmlText(code).replace(/[^\w .-]/g, "")}`);
    throw new HttpError(
      502,
      r.status === 403
        ? "The backup storage refused access. Check the keys and the bucket’s permissions."
        : "The backup storage refused the request. Check endpoint, region and bucket.",
    );
  }

  async put(key: string, file: string) {
    const size = statSync(file).size;
    const h = createHash("sha256");
    for await (const c of createReadStream(file)) h.update(c as Buffer);
    // the signed payload hash makes S3 verify every byte that arrives
    const r = await this.request("PUT", key, {}, { file, size, sha256: h.digest("hex") });
    if (r.status !== 200) await this.fail(r, "the upload");
    r.stream.resume();
  }
  async get(key: string) {
    const r = await this.request("GET", key);
    if (r.status === 404) {
      r.stream.resume();
      throw new HttpError(404, "Backup not found.");
    }
    if (r.status !== 200) await this.fail(r, "the download");
    return r.stream;
  }
  async exists(key: string) {
    const r = await this.request("HEAD", key);
    r.stream.resume();
    if (r.status === 200) return true;
    if (r.status === 404) return false;
    return this.fail(r, "a check");
  }
  async list(prefix: "v2/" | "v2/objects/") {
    const out: { key: string; size: number }[] = [];
    let token: string | undefined;
    for (let page = 0; page < 1000; page++) {
      const q: Record<string, string> = { "list-type": "2", prefix: this.c.prefix + prefix, delimiter: "/" };
      if (token) q["continuation-token"] = token;
      const r = await this.request("GET", null, q);
      if (r.status !== 200) await this.fail(r, "the listing");
      const xml = await r.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const full = xmlText(/<Key>([^<]*)<\/Key>/.exec(m[1])?.[1] ?? "");
        const size = Number(/<Size>(\d{1,15})<\/Size>/.exec(m[1])?.[1] ?? -1);
        if (!full.startsWith(this.c.prefix)) continue;
        const key = full.slice(this.c.prefix.length);
        if (KEY_RE.test(key) && size >= 0) out.push({ key, size });
      }
      if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
      token = xmlText(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "");
      if (!token) break;
    }
    return out;
  }
  async delete(key: string) {
    const r = await this.request("DELETE", key);
    if (r.status !== 204 && r.status !== 200 && r.status !== 404) await this.fail(r, "a deletion");
    r.stream.resume();
  }
}
