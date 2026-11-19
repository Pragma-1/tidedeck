import "./setup-env";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sniff, stripImage, stripJpeg, storeUpload, listMedia, deleteMedia } from "@/lib/media";
import { renderMarkdown } from "@/lib/markdown";
import { classify } from "@/lib/embed-url";
import * as auth from "@/lib/auth";
import { db } from "./pg";
import { now } from "@/lib/db";
import { updateSettings } from "@/lib/settings";
import { generateLegal, getLegal, resetLegal, setLegal } from "@/lib/legal";
import { purgeExpired } from "@/lib/retention";
import { audit } from "@/lib/audit";
import { Parser } from "htmlparser2";

/** Real HTML parse: every tag and attribute as a browser would see them. */
function tags(html: string) {
  const out: { name: string; attrs: Record<string, string> }[] = [];
  new Parser({ onopentag: (name, attrs) => out.push({ name, attrs }) }, { decodeEntities: true }).end(html);
  return out;
}

const fx = (n: string) => readFileSync(path.join(import.meta.dirname, "fixtures", n));
const has = (b: Buffer, s: string) => b.includes(Buffer.from(s));
const stream = (b: Buffer) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < b.length; i += 7000) c.enqueue(new Uint8Array(b.subarray(i, i + 7000)));
      c.close();
    },
  });

describe("file type detection", () => {
  it("accepts only real images/videos by their bytes", async () => {
    expect(sniff(fx("exif.jpg"))?.mime).toBe("image/jpeg");
    expect(sniff(fx("meta.png"))?.mime).toBe("image/png");
    expect(sniff(fx("exif.webp"))?.mime).toBe("image/webp");
    expect(sniff(fx("comment.gif"))?.mime).toBe("image/gif");
    expect(sniff(fx("tiny.mp4"))?.mime).toBe("video/mp4");
    expect(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))).toBeNull();
    expect(sniff(Buffer.from("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(sniff(Buffer.from("%PDF-1.7"))).toBeNull();
    expect(sniff(Buffer.from("MZ\x90\x00"))).toBeNull();
  });
});

describe("metadata stripping", () => {
  it("JPEG: removes EXIF/GPS, comments and appended trailers but keeps the orientation", async () => {
    const src = fx("exif.jpg");
    expect(has(src, "SECRET-CAMERA-MAKE") && has(src, "SECRET-COMMENT") && has(src, "TRAILER-SECRET")).toBe(true);
    const out = stripJpeg(src);
    for (const s of ["SECRET-CAMERA-MAKE", "SECRET-COMMENT", "TRAILER-SECRET"]) expect(has(out, s), s).toBe(false);
    expect(out.includes(Buffer.from([0x88, 0x25]))).toBe(false); // no GPS IFD pointer tag
    expect(out.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
    // orientation 6 preserved in a minimal EXIF block
    const i = out.indexOf(Buffer.from("Exif\0\0"));
    expect(i).toBeGreaterThan(0);
    expect(out.readUInt16LE(i + 6 + 8 + 2)).toBe(0x0112);
    expect(out[i + 6 + 8 + 2 + 8]).toBe(6);
    expect(stripJpeg(out).equals(out)).toBe(true); // idempotent
  });
  it("PNG, WebP and GIF: text/EXIF/comment blocks removed, image data intact", async () => {
    for (const [f, ext, secret] of [
      ["meta.png", "png", "SECRET"],
      ["exif.webp", "webp", "SECRET-CAMERA-MAKE"],
      ["comment.gif", "gif", "SECRET-GIF-COMMENT"],
    ] as const) {
      const src = fx(f),
        out = stripImage(src, ext);
      expect(has(out, secret), f).toBe(false);
      expect(sniff(out)?.ext, f).toBe(ext);
      expect(out.length).toBeLessThan(src.length);
    }
    const webp = stripImage(fx("exif.webp"), "webp");
    expect(webp.readUInt32LE(4)).toBe(webp.length - 8); // RIFF size fixed up
  });
  it("rejects truncated or garbage files instead of storing them half-parsed", async () => {
    const jpg = fx("exif.jpg");
    expect(() => stripJpeg(jpg.subarray(0, 40))).toThrow();
    expect(() => stripImage(Buffer.concat([fx("meta.png").subarray(0, 30)]), "png")).toThrow();
    expect(() => stripImage(Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00\x99"), "gif")).toThrow();
    expect(() => stripJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toThrow();
  });
});

describe("uploads", () => {
  let uid = 0;
  it("stores a cleaned image under a random name and refuses non-media", async () => {
    uid = await auth.setupAdmin(
      (await auth.ensureSetupToken())!,
      "chef",
      "chef@example.com",
      "tidal-marsh-lantern-47",
      null,
    );
    const m = await storeUpload(stream(fx("exif.jpg")), 0, "Urlaub <script>.jpg", uid);
    expect(m.name).toMatch(/^[A-Za-z0-9_-]{22}\.jpg$/);
    expect(m.original_name).toBe("Urlaub script.jpg");
    const stored = readFileSync(path.join(process.env.WIKI_DATA_DIR!, "media", m.name));
    expect(has(stored, "SECRET")).toBe(false);
    await expect(
      storeUpload(stream(Buffer.from("<svg onload=alert(1)>".padEnd(200, " "))), 0, "x.svg", uid),
    ).rejects.toThrow(/Only PNG/);
    await expect(storeUpload(stream(Buffer.alloc(0)), 0, null, uid)).rejects.toThrow(/Only PNG/);
    const v = await storeUpload(stream(fx("tiny.mp4")), 0, "clip.mp4", uid);
    expect(v.kind).toBe("video");
    expect((await listMedia()).length).toBe(2);
    expect((await listMedia())[0].used_in).toBe(0);
    await deleteMedia(v.id, { id: uid, role: "admin" });
    expect((await listMedia()).length).toBe(1);
    await expect(deleteMedia(m.id, { id: 999, role: "editor" })).rejects.toThrow(/uploader/);
  });
  it("enforces the size limit while streaming", async () => {
    const big = Buffer.concat([fx("exif.jpg"), Buffer.alloc(16 * 1024 * 1024)]);
    await expect(storeUpload(stream(big), 0, "big.jpg", uid)).rejects.toThrow(/too large/);
    await expect(storeUpload(stream(fx("exif.jpg")), 10 * 1024 * 1024 * 1024, "x.jpg", uid)).rejects.toThrow(
      /too large/,
    );
  });
});

describe("embeds in Markdown", () => {
  const html = (s: string, o = {}) => renderMarkdown(s, { lang: "de", ...o }).html;
  it("classifies video links", async () => {
    for (const u of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?t=3",
      "https://youtube.com/shorts/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x",
    ])
      expect(classify(u)).toEqual({
        kind: "youtube",
        id: "dQw4w9WgXcQ",
        href: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      });
    expect(classify("https://vimeo.com/76979871")?.kind).toBe("vimeo");
    expect(classify("https://player.vimeo.com/video/76979871")?.kind).toBe("vimeo");
    expect(classify("https://cdn.example.org/a/b.mp4")).toEqual({
      kind: "video",
      src: "https://cdn.example.org/a/b.mp4",
    });
    expect(classify("/media/AAAAAAAAAAAAAAAAAAAAAA.mp4")?.kind).toBe("video");
    expect(classify("https://twitch.tv/videos/1")?.kind).toBe("link");
    expect(classify("javascript:alert(1)")).toBeNull();
    expect(classify("/etc/passwd")).toBeNull();
    expect(classify("https://www.youtube.com/watch?v=<script>")?.kind).toBe("link");
  });
  it("YouTube/Vimeo render a click-to-load placeholder: no iframe, nothing loaded from the provider", async () => {
    const out = html("@[Einführung](https://www.youtube.com/watch?v=dQw4w9WgXcQ)");
    expect(out).toContain('data-embed="youtube"');
    expect(out).toContain('data-id="dQw4w9WgXcQ"');
    expect(out).toContain("Video laden");
    expect(out).not.toMatch(/<iframe|<script|ytimg|youtube-nocookie/);
    expect(html("![](https://vimeo.com/76979871)")).toContain('data-embed="vimeo"');
  });
  it("direct video files get a player that never autoplays or preloads", async () => {
    const out = html("@[Clip](/media/AAAAAAAAAAAAAAAAAAAAAA.mp4)");
    expect(out).toMatch(/<video src="\/media\/AAAAAAAAAAAAAAAAAAAAAA\.mp4" controls preload="none" playsinline>/);
    expect(out.startsWith("<figure")).toBe(true); // a block embed isn't wrapped in an empty paragraph
    expect(out).not.toMatch(/autoplay/);
    expect(html("![x](https://cdn.example.org/v.webm)")).toContain("<video");
    expect(html("@[x](http://cdn.example.org/v.mp4)")).not.toContain("<video"); // plain http video is not played
  });
  it("other links become a link card; external images wait for a click unless autoload is on", async () => {
    expect(html("@[Mitschnitt](https://example.org/watch/1)")).toMatch(
      /class="video-link ext" href="https:\/\/example\.org\/watch\/1" rel="noopener noreferrer nofollow ugc" target="_blank"/,
    );
    const ext = html("![Logo](https://example.org/logo.png)");
    expect(ext).toContain('data-embed="image"');
    expect(ext).not.toMatch(/<img/);
    expect(html("![Logo](https://example.org/logo.png)", { autoloadExternal: true })).toMatch(
      /<img src="https:\/\/example\.org\/logo\.png"/,
    );
    expect(html("![Foto](/media/AAAAAAAAAAAAAAAAAAAAAA.jpg)")).toMatch(
      /<img src="\/media\/AAAAAAAAAAAAAAAAAAAAAA\.jpg"/,
    );
  });
  it("embed syntax can't be used for injection", async () => {
    const evil = [
      '@["><img src=x onerror=alert(1)>](https://youtu.be/dQw4w9WgXcQ)',
      "@[x](javascript:alert(1))",
      '@[x](https://youtu.be/dQw4w9WgXcQ"onmouseover="alert(1))',
      '![" onerror="alert(1)](https://example.org/a.png)',
      "@[x](data:text/html;base64,PHNjcmlwdD4=)",
      '@[x](https://example.org/a.mp4#"><script>alert(1)</script>)',
    ];
    for (const e of evil) {
      const out = html(e);
      for (const t of tags(out)) {
        expect(["script", "iframe", "object", "embed", "svg"], e).not.toContain(t.name);
        for (const [k, v] of Object.entries(t.attrs)) {
          expect(k.startsWith("on"), `${e}: ${t.name}[${k}]`).toBe(false);
          if (["href", "src", "data-src"].includes(k)) expect(v, e).toMatch(/^(https:\/\/|\/)/);
        }
      }
    }
  });
});

describe("legal pages", () => {
  it("templates reflect the operator details and real settings", async () => {
    await updateSettings({
      operator_name: "DRK Muster e. V.",
      operator_address: "Musterstraße 1\n10115 Berlin",
      operator_email: "datenschutz@example.org",
      log_retention_days: 90,
    });
    const de = await generateLegal("privacy", "de");
    expect(de).toContain("DRK Muster e. V.");
    expect(de).toContain("Musterstraße 1  \n10115 Berlin");
    expect(de).toContain("nach 90 Tagen");
    expect(de).toMatch(/Art\. 77 DSGVO/);
    expect(de).toMatch(/§ 25 Abs\. 2 Nr\. 2 TDDDG/);
    expect(de).not.toMatch(/IP-Adressen werden nach/); // no proxy configured -> no IPs logged, and the text says so
    expect(await generateLegal("imprint", "de")).toMatch(/§ 5 DDG/);
    expect(await generateLegal("terms", "en")).toMatch(/Terms of use/);
  });
  it("operator text can't inject links or HTML", async () => {
    await updateSettings({ operator_name: "[Klick](javascript:alert(1)) <b>x</b>" });
    const out = renderMarkdown(await generateLegal("imprint", "de")).html;
    expect(out).not.toMatch(/href="javascript|<b>/);
    await updateSettings({ operator_name: "DRK Muster e. V." });
    expect(await updateSettings({ operator_email: "not an email" })).toMatchObject({ ok: false });
    expect(await updateSettings({ operator_name: "a\u0000b" })).toMatchObject({ ok: false });
    expect(await updateSettings({ operator_address: "x".repeat(301) })).toMatchObject({ ok: false });
  });
  it("custom text per language overrides the template until reset", async () => {
    await setLegal("terms", "de", "# Eigene Bedingungen", 1);
    expect(await getLegal("terms", "de")).toMatchObject({ custom: true, content: "# Eigene Bedingungen" });
    expect((await getLegal("terms", "en")).custom).toBe(false);
    await expect(setLegal("terms", "de", "   ", 1)).rejects.toThrow(/empty/);
    expect(await resetLegal("terms", "de")).toBe(true);
    expect((await getLegal("terms", "de")).custom).toBe(false);
  });
});

describe("retention", () => {
  it("removes old IPs and old log entries", async () => {
    await updateSettings({ ip_retention_days: 7, log_retention_days: 30 });
    const t = now();
    await db()
      .prepare("INSERT INTO audit_log(ts,user_id,event,ip) VALUES(?,?,?,?)")
      .run(t - 8 * 86400, null, "login.failed", "203.0.113.1");
    await db()
      .prepare("INSERT INTO audit_log(ts,user_id,event,ip) VALUES(?,?,?,?)")
      .run(t - 31 * 86400, null, "login.failed", "203.0.113.2");
    await audit("login.failed", null, "203.0.113.3");
    await purgeExpired();
    const rows = (await db().prepare("SELECT ip FROM audit_log WHERE event='login.failed' ORDER BY ts").all()) as {
      ip: string | null;
    }[];
    expect(rows).toEqual([{ ip: null }, { ip: "203.0.113.3" }]);
  });
});
